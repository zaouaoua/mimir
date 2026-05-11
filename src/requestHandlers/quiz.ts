import { prisma } from "../model/db";
import { Request, Response } from "express";
import { assert, object, string, refine, enums, optional, array } from "superstruct";

import * as openTDB from "../model/opentdb";
import * as userUtils from "../utils/userUtils";
import * as gameUtils from "../utils/gameUtils";
import { getAverageScore } from "../utils/gameUtils";
import { off } from "process";
import { cloneFile } from "./file";
import { dir } from "console";

class HttpError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

// Schéma pour une question
const QuestionSchema = object({
    text: string(),
    correctAnswer: string(),
    incorrectAnswers: array(string()),
    type : enums(['text', 'audio', 'image'])
});

// Schéma pour la création d'un quiz
const CreateQuizQuerySchema = object({
    category: optional(refine(string(), 'category', value => {
        if (isNaN(parseInt(value))) {
            throw new HttpError('Category must be a number', 400);
        }
        if (parseInt(value) < 9 || parseInt(value) > 32) {
            throw new HttpError('Category must be between 9 and 32', 400);
        }
        return true;
    })),
    difficulty: optional(enums(['easy', 'medium', 'hard'])),
    title: string(),
    public: optional(string()),
});

// Schéma pour le corps de la requête de création d'un quiz
const CreateQuizBodySchema = object({
    questions: array(QuestionSchema) 
});

// Schéma pour la requête de création rapide d'un quiz
const CreateQuizFastQuerySchema = object({
    amount: refine(string(), 'amount', value => {
        if (isNaN(parseInt(value))) {
            throw new HttpError('Amount must be a number', 400);
        }
        if (parseInt(value) < 1 || parseInt(value) > 50) {
            throw new HttpError('Amount must be between 1 and 50', 400);
        }
        return true;
    }
    ),
    category: optional(refine(string(), 'category', value => {
        if (isNaN(parseInt(value))) {
            throw new HttpError('Category must be a number', 400);
        }
        if (parseInt(value) < 9 || parseInt(value) > 32) {
            throw new HttpError('Category must be between 9 and 32', 400);
        }
        return true;
    })),
    difficulty: optional(enums(['easy', 'medium', 'hard']))
});

const ListQuizQuerySchema = object({
    title: optional(string()),
    category: optional(refine(string(), 'category', value => {
        if (isNaN(parseInt(value))) {
            throw new HttpError('Category must be a number', 400);
        }
        if (parseInt(value) < 9 || parseInt(value) > 32) {
            throw new HttpError('Category must be between 9 and 32', 400);
        }
        return true;
    })),
    difficulty: optional(enums(['easy', 'medium', 'hard']))
});

export async function create(req: Request, res: Response) {
    try{
        assert(req.query, CreateQuizQuerySchema);
        assert(req.body, CreateQuizBodySchema);
        //le type ne peut avoir que 3 valeurs : texte, audio, image
    
        
        
        const publicQuiz = req.query.public === "true";

        let quizData: any= {
            title: req.query.title as string,
            category: Number(req.query.category),
            difficulty: req.query.difficulty as string,
            public:  publicQuiz
        }

        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        quizData.user = {
            connect: { id: user.id }
        }

        const quiz = await prisma.quiz.create({
            data: quizData
        });
    
        const questionsData = req.body.questions.map(question => {
            let trueFalse = question.incorrectAnswers.length === 1;
        
            return {
                text: question.text,
                trueFalse: trueFalse,
                correctAnswer: question.correctAnswer,
                falseAnswer1: question.incorrectAnswers[0] || null,
                falseAnswer2: question.incorrectAnswers[1] || null,
                falseAnswer3: question.incorrectAnswers[2] || null,
                quizId: quiz.id,
                type : question.type
               
            };
        });
        
        await prisma.question.createMany({
            data: questionsData
        });        

        return res.status(201).json({quizId: quiz.id});
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({error: error.message});
        } else {
            return res.status(500).json({error: error.message});
        }
    }
}

// Fonction pour obtenir un quiz à partir de son id
export async function retrieve(req: Request, res: Response) {
    try{
        const quizId = req.params.id;
        
        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        const quiz = await prisma.quiz.findUnique({
            where: { id: Number(quizId) },
            include: { questions: true }
        });

        if (!quiz) {
            throw new HttpError("Quiz non trouvé", 404);
        }

        if (quiz.userId !== user.id) {
            throw new HttpError("Ce quiz ne vous appartient pas", 403);
        }

        const results = {
            title: quiz.title,
            category: quiz.category,
            difficulty: quiz.difficulty,
            public: quiz.public,
            questions: quiz.questions.map((question: any) => {
                return {
                    text: question.text,
                    trueFae: question.trueFalse,
                    correctAnswer: question.correctAnswer,
                    incorrectAnswers: [question.falseAnswer1, question.falseAnswer2, question.falseAnswer3].filter(Boolean),
                    type : question.type    
                }
            })
        }

        return res.status(200).json({quiz: results});
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({error: error.message});
        } else {
            return res.status(500).json({error: error.message});
        }
    }
}

// Fonction pour éditer un quiz
export async function edit(req: Request, res: Response) {
    try{
        const quizId = req.params.id;

        assert(req.body, CreateQuizBodySchema);
        assert(req.query, CreateQuizQuerySchema);

        const quiz = await prisma.quiz.findUnique({
            where: { id: Number(quizId) },
            include: { questions: true }
        });

        if (!quiz) {
            throw new HttpError("Quiz non trouvé", 404);
        }

        if (quiz.public) {
            throw new HttpError("Vous ne pouvez pas modifier un quiz public", 403);
        }

        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        if (quiz.userId !== user.id) {
            throw new HttpError("Ce quiz ne vous appartient pas", 403);
        }

        await prisma.quiz.update({
            where: { id: quiz.id },
            data: {
                title: req.query.title as string,
                category: Number(req.query.category),
                difficulty: req.query.difficulty as string,
                updatedAt: new Date(Date.now())
            }
        });

        await prisma.question.deleteMany({
            where: {
                quizId: quiz.id
            }
        });

        const questionsData = req.body.questions.map(question => {
            let trueFalse = question.incorrectAnswers.length === 1;
        
            return {
                text: question.text,
                trueFalse: trueFalse,
                correctAnswer: question.correctAnswer,
                falseAnswer1: question.incorrectAnswers[0] || null,
                falseAnswer2: question.incorrectAnswers[1] || null,
                falseAnswer3: question.incorrectAnswers[2] || null,
                quizId: quiz.id,
                type : question.type
            };
        });
        
        await prisma.question.createMany({
            data: questionsData
        });
        

        return res.status(200).json({quizId: quiz.id});
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({error: error.message});
        } else {
            return res.status(500).json({error: error.message});
        }
    }
}
// Fonction pour publier un quiz
export async function publish(req: Request, res: Response) {
    try{
        const quizId = req.params.id;

        const quiz = await prisma.quiz.findUnique({
            where: { id: Number(quizId) },
            include: { questions: true }
        });

        if (!quiz) {
            throw new HttpError("Quiz non trouvé", 404);
        }

        if (quiz.public) {
            throw new HttpError("Ce quiz est déjà public", 403);
        }

        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        if (quiz.userId !== user.id) {
            throw new HttpError("Ce quiz ne vous appartient pas", 403);
        }

        await prisma.quiz.update({
            where: { id: quiz.id },
            data: {
                public: true
            }
        });

        return res.status(200).json({quizId: quiz.id});
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({error: error.message});
        } else {
            return res.status(500).json({error: error.message});
        }
    }
}


// Fonction pour créer un quiz rapidement
export async function fastCreate(req: Request, res: Response) {
    try{
        assert(req.query, CreateQuizFastQuerySchema);

        const amount = req.query.amount as string;
        const category = req.query.category as string | undefined;
        const difficulty = req.query.difficulty as string | undefined;

        const questionData = await openTDB.fetchQuestions(amount, category, difficulty);    

        let quizData: any= {
            title: "Fast Quiz",
            public:  true
        }

        if(category){
            quizData.category = Number(category);
        }
        if(difficulty){
            quizData.difficulty = difficulty;
        }

        const quiz = await prisma.quiz.create({
            data: quizData
        });

        const questions = questionData.map((question: any) => ({
            text: question.question,
            trueFalse: question.incorrect_answers.length !== 3,
            correctAnswer: question.correct_answer,
            falseAnswer1: question.incorrect_answers[0] || null,
            falseAnswer2: question.incorrect_answers[1] || null,
            falseAnswer3: question.incorrect_answers[2] || null,
            quizId: quiz.id,
            type : 'text'
        }));
        
        await prisma.question.createMany({
            data: questions,
        });
        
        const gameId = await gameUtils.getUniqueId();

        const gameData: any = {
            id: gameId,
            questionCursor: 0,
            quiz: {
                connect: { id: quiz.id }
            }
        };

        const user = await userUtils.getUser(req);

        if (user) {
            gameData.user = {
                connect: { id: user.id }
            };
        }

        await prisma.game.create({
            data: gameData
        });

        const quizQuestions = await prisma.question.findMany({
            where: {
                quizId: quiz.id
            }
        });

        const answers = quizQuestions.map((question: any) => ({
            questionId: question.id,
            gameId: gameId, 
            correct: false
        }));
        
        await prisma.answer.createMany({
            data: answers,
        });
        
        return res.status(200).json({id: gameId});
    }    
    catch (error: any) {
        return res.status(500).json({error: error.message});
    }
}

// Fonction pour obtenir un quiz à partir de son id et le cloner
export async function clone(req: Request, res: Response) {
    try{
        const quizId = req.params.id;

        assert(quizId, string());

        const quiz = await prisma.quiz.findUnique({
            where: {
                id: Number(quizId),
                public: true
            },
            include: {
                questions: true
            }
        });


        const user = await userUtils.getUser(req);



        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }



        const userQuiz = await prisma.user.findUnique({
            where: {
                id: quiz!.userId ?? undefined
            },
            select: {
                id: true,
                userName: true
            }
        });


        if (!quiz) {
            throw new HttpError("Quiz non trouvé", 404);
        }

        let questions = quiz.questions.map((question: any) => {
            return {
                text: question.text,
                correctAnswer: question.correctAnswer,
                incorrectAnswers: [question.falseAnswer1, question.falseAnswer2, question.falseAnswer3].filter(Boolean),
                type : question.type
            }
        });
if (!userQuiz) {
    throw new HttpError("User quiz not found", 404);
}
const dirPath = 'uploads/' + userQuiz.userName + '_' + userQuiz.id;
const  dirTargetPath = 'uploads/'+user.userName+'_'+user.id;

        for (let i = 0; i < questions.length; i++) {
            if (questions[i].type !=  'text'){

                    cloneFile(questions[i].correctAnswer, dirPath , dirTargetPath);

                    for (let j = 0; j < questions[i].incorrectAnswers.length; j++) {
                        if (questions[i].incorrectAnswers[j] !== null) {
                            cloneFile(questions[i].incorrectAnswers[j] as string,dirPath , dirTargetPath);
                        }
                    }                   
            }

        }

        return res.status(201).json({questions: questions});
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({error: error.message});
        } else {
            return res.status(500).json({error: error.message});
        }
    }
}

// Fonction pour obtenir une liste de quiz
export async function list(req: Request, res: Response) {
    try {
        assert(req.query, ListQuizQuerySchema);

        let where: any = {
            public: true,
            userId: {
                not: null
            }
        };

        const title = req.query.title as string;

        if (title) {
            where.title = {
                contains: title
            };
        }

        const category = req.query.category as string;

        if (category) {
            where.category = Number(category);
        }

        const difficulty = req.query.difficulty as string;

        if (difficulty) {
            where.difficulty = difficulty;
        }

        const quizs = await prisma.quiz.findMany({
            where
        });

        return res.status(200).json({ quizs: quizs });
    }
    catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}


export async function score(req : Request, res : Response){
  try{
    const quizId = req.params.id;
        
    const user = await userUtils.getUser(req);

    if (!user) {
        throw new HttpError("Utilisateur non trouvé", 401);
    }

    const quiz = await prisma.quiz.findUnique({
        where: { id: Number(quizId) },
        include: { games : true }
    });

    if (!quiz) {
        throw new HttpError("Quiz non trouvé", 404);
    }

    if (quiz.userId !== user.id) {
        throw new HttpError("Ce quiz ne vous appartient pas", 403);
    }
     
    let score =0;
    for ( let i=0 ; i<quiz.games.length ; i++){
        score += await getAverageScore(quiz.games[i].id);
        
    }

    score = score / quiz.games.length;
    
    return res.status(200).json({score: score , nombreDePartie : quiz.games.length});
    
  }      
  catch (error: any) {
    if (error instanceof HttpError) {
        return res.status(error.status).json({error: error.message});
    } else {
        return res.status(500).json({error: error.message});
    }
  }
}



export async function deleteQuiz(req : Request, res : Response){

    const quizId = req.params.id;
    const user = await userUtils.getUser(req);
    if (!user) {
        throw new HttpError("Utilisateur non trouvé", 401);
    }
    const quiz = await prisma.quiz.findUnique({
        where: { id: Number(quizId) },
    });

    if (!quiz) {
        throw new HttpError("Quiz non trouvé", 404);
    }

    if (quiz.userId !== user.id) {
        throw new HttpError("Ce quiz ne vous appartient pas", 403);
    }

    await prisma.quiz.delete({
        where: { id: Number(quizId) },
    });

    return res.status(200).json({message: "Quiz supprimé"});
}