import { prisma } from "../model/db";
import { Request, Response } from "express";
import { assert, integer, string, optional } from "superstruct";
import * as gameUtils from "../utils/gameUtils";
import * as userUtils from "../utils/userUtils";
import * as timerUtils from "../utils/timerUtils";

class HttpError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

export async function create(req: Request, res: Response) {
    try {
        const quizId = Number(req.params.id);
        const gameMode = req.query.gameMode as string;
        const difficulty = req.query.difficulty as string;

        assert(quizId, integer());
        assert(gameMode, optional(string()));
        assert(difficulty, optional(string()));

        const quiz = await prisma.quiz.findUnique({
            where: {
                id: quizId
            },
            include: {
                questions: true
            }
        });

        if (!quiz) {
            throw new HttpError("Quiz non trouvé", 404);
        }

        if (!quiz.public) {
            throw new HttpError("Quiz non publié", 403);
        }

        const user = await userUtils.getUser(req);

        const gameId = await gameUtils.getUniqueId();

        const gameData: any = {
            id: gameId,
            questionCursor: 0,
            quiz: {
                connect: { id: quiz.id }
            }
        };

        if (user) {
            gameData.user = {
                connect: { id: user.id }
            };
        }

        if (gameMode) {
            gameData.mode = gameMode;
        }

        if (difficulty) {
            gameData.difficulty = difficulty;
        }

        await prisma.game.create({
            data: gameData
        });

        const answers = quiz.questions.map(question => ({
            questionId: question.id,
            gameId: gameId,
            correct: false
        }));

        await prisma.answer.createMany({
            data: answers
        });

        return res.status(201).json({ id: gameId });
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(500).json({ error: error.message });
        }
    }
}

// Fonction pour obtenir la question courante de la partie
export async function currentQuestion(req: Request, res: Response) {
    try {
        const gameId = req.params.id;

        assert(gameId, string());

        const game = await prisma.game.findUnique({
            where: {
                id: gameId
            },
            include: {
                quiz: {
                    include: {
                        questions: true
                    }
                },
            }
        });

        if (!game) {
            throw new HttpError("Partie non trouvée !", 404);
        }

        if (game.userId !== null) {
            const user = await userUtils.getUser(req);

            if (user?.id !== game.userId) {
                throw new HttpError("Cette partie ne peut pas être jouée avec ce compte", 403);
            }
        }

        let questionCursor = game.questionCursor;

        if (questionCursor >= game.quiz.questions.length) {
            throw new HttpError("Aucune question restante dans ce quiz.", 500);
        }

        if (game.mode === "timed" && !timerUtils.hasActiveTimer(gameId)) {

            let duration = 0;

            switch (game.difficulty) {
                case "easy":
                    duration = 30;
                    break;
                case "medium":
                    duration = 15;
                    break;
                case "hard":
                    duration = 5;
                    break;
                default:
                    duration = 15;
                    break;
            }
            
            timerUtils.startTimer(gameId, duration);
        }

        const question = game.quiz.questions[questionCursor];

        let answers = [];

        if (question.trueFalse) {
            answers = [question.correctAnswer, question.falseAnswer1];
        }
        else {
            answers = [question.correctAnswer, question.falseAnswer1, question.falseAnswer2, question.falseAnswer3];
        }

        for (let i = answers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [answers[i], answers[j]] = [answers[j], answers[i]];
        }

        return res.status(200).json({
            question: question.text,
            type : question.type,
            answers: answers
        });
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(500).json({ error: error.message });
        }
    }
}

// Fonction pour vérifier la réponse à une question
export async function verifyCurrentQuestionAnswer(req: Request, res: Response) {
    try {
        const gameId = req.params.id;
        const answer = req.body.answer;

        assert(gameId, string());
        assert(answer, string());

        const game = await prisma.game.findUnique({
            where: {
                id: gameId
            },
            include: {
                quiz: {
                    include: {
                        questions: true
                    }
                }
            }
        });

        if (!game) {
            throw new HttpError("Partie non trouvée", 404);
        }

        if (game.userId !== null) {
            const user = await userUtils.getUser(req);

            if (user?.id !== game.userId) {
                throw new HttpError("Cette partie ne peut pas être jouée avec ce compte", 403);
            }
        }

        const questionCursor = game.questionCursor;

        if (game.mode === "timed") {
            if (timerUtils.hasActiveTimer(gameId)) {
                timerUtils.interruptTimer(gameId);
            }
            else {
                throw new HttpError("Le temps est écoulé", 500);
            }
        }

        if (questionCursor !== game.quiz.questions.length) {

            const question = game.quiz.questions[questionCursor];
            const correctAnswer = question.correctAnswer;
            const wasCorrect = answer === correctAnswer;

            await prisma.answer.update({
                where: {
                    questionId_gameId: {
                        questionId: question.id,
                        gameId: game.id
                    }
                },

                data: {
                    correct: wasCorrect
                }
            });

            const nextQuestion = questionCursor + 1;

            await prisma.game.update({
                where: {
                    id: game.id
                },
                data: {
                    questionCursor: nextQuestion
                }
            });

            return res.status(200).json({ correctAnswer: correctAnswer });
        }
        else {
            throw new HttpError("Aucune question restante dans ce quiz.", 500);
        }
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(500).json({ error: error.message });
        }
    }
}

// Fonction pour obtenir les informations d'une partie
export async function infos(req: Request, res: Response) {
    try {
        const gameId = req.params.id;

        assert(gameId, string());
        const game = await prisma.game.findUnique({
            where: {
                id: gameId
            },
            include: {
                quiz: {
                    include: {
                        questions: true
                    }
                },
                answers: true
            }
        });

        if (!game) {
            throw new HttpError("Partie non trouvée", 404);
        }

        if (game.userId !== null) {
            const user = await userUtils.getUser(req);

            if (user?.id !== game.userId) {
                throw new HttpError("Cette partie ne peut pas être jouée avec ce compte", 403);
            }
        }

        const numberOfQuestions = game.quiz.questions.length;

        const questionCursor = game.questionCursor;

        let results: any = [];

        game.answers.sort((a, b) => a.questionId - b.questionId);

        game.answers.map((answer) => {
            results.push(answer.correct);
        });

        return res.status(200).json({ results: results, questionCursor: questionCursor, numberOfQuestions: numberOfQuestions, quizDifficulty: game.quiz.difficulty, quizCategory: game.quiz.category, gameDifficulty: game.difficulty, gameMode: game.mode, CreateDate: game.createdAt , Title : game.quiz.title});
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(500).json({ error: error.message });
        }
    }
}

export async function restart(req: Request, res: Response) {
    try {
        const gameId = req.params.id;

        assert(gameId, string());

        const game = await prisma.game.findUnique({
            where: {
                id: gameId
            },
            include: {
                quiz: {
                    include: {
                        questions: true
                    }
                }
            }
        });

        if (!game) {
            throw new HttpError("Partie non trouvée", 404);
        }

        if (game.userId !== null) {
            const user = await userUtils.getUser(req);

            if (user?.id !== game.userId) {
                throw new HttpError("Cette partie ne peut pas être jouée avec ce compte", 403);
            }
        }

        // Prendre en compte le mode de jeu et la difficulté
        const quizId = game.quiz.id.toString();
        const gameMode = game.mode || ''; // Réinitialiser le mode de jeu
        const difficulty = game.difficulty || ''; // Réinitialiser la difficulté

     

        // Appeler la fonction create avec les valeurs de req.query
        await createWithParams(req, res, quizId, gameMode, difficulty);
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(500).json({ error: error.message });
        }
    }
}

export async function average(req: Request, res: Response) {
    try {
        const gameId = req.params.id;
        assert(gameId, string());

        const game = await prisma.game.findUnique({
            where: {
                id: gameId
            },
            include: {
                quiz: {
                    include: {
                        questions: true
                    }
                },
                answers: true // Inclure les réponses dans la requête
            }
        });

        if (!game) {
            throw new HttpError("Partie non trouvée", 404);
        }

        // Calculer la moyenne des scores
        const totalQuestions = game.quiz.questions.length;
        const correctAnswers = game.answers.filter(answer => answer.correct).length;
        const averageScore = (correctAnswers / totalQuestions) * 100;

        return res.status(200).json({
            averageScore: averageScore
        });
    } 
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(500).json({ error: error.message });
        }
    }
}

export async function createWithParams(req: Request, res: Response, quizId: string, gameMode: string, difficulty: string) {
    try {
        const quizIdNumber = Number(quizId);

        assert(quizIdNumber, integer());
        assert(gameMode, optional(string()));
        assert(difficulty, optional(string()));


        const quiz = await prisma.quiz.findUnique({
            where: {
                id: quizIdNumber
            },
            include: {
                questions: true
            }
        });

        if (!quiz) {
            throw new HttpError("Quiz non trouvé", 404);
        }

        if (!quiz.public) {
            throw new HttpError("Quiz non publié", 403);
        }

        const user = await userUtils.getUser(req);

        const gameId = await gameUtils.getUniqueId();

        const gameData: any = {
            id: gameId,
            questionCursor: 0,
            quiz: {
                connect: { id: quiz.id }
            }
        };

        if (user) {
            gameData.user = {
                connect: { id: user.id }
            };
        }

        if (gameMode) {
            gameData.mode = gameMode;
        }

        if (difficulty) {
            gameData.difficulty = difficulty;
        }

        await prisma.game.create({
            data: gameData
        });

        const answers = quiz.questions.map(question => ({
            questionId: question.id,
            gameId: gameId,
            correct: false
        }));

        await prisma.answer.createMany({
            data: answers
        });

        return res.status(201).json({ id: gameId });
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(500).json({ error: error.message });
        }
    }
}



export async function deleteGame(req: Request, res: Response) {
    try {
        const gameId = req.params.id;

        assert(gameId, string());

        const game = await prisma.game.findUnique({
            where: {
                id: gameId
            }
        });

        if (!game) {
            throw new HttpError("Partie non trouvée", 404);
        }

        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 404);
        }


        if (user.id !== game.userId) {
            throw new HttpError("Cette partie ne peut pas être supprimée par ce compte", 403);
        }

        await prisma.game.delete({
            where: {
                id: gameId
            }
        });

        return res.status(200).json({ message: "Partie supprimée" });
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(500).json({ error: error.message });
        }
    }
}