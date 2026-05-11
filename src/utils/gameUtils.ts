import { prisma } from "../model/db";
import { humanId } from "human-id";

// Fonction qui permet de récupérer un identifiant unique pour un quiz
export async function getUniqueId() {
    const allowedAttempts = 10;

    for(let i = 0; i < allowedAttempts; i++) {
        const id = humanId({
            separator: '-',
            capitalize: false
        });

        let quiz = await prisma.game.findUnique({
            where: {
                id: id
            }
        });

        if (!quiz) {
            return id;
        }
    }

    throw new Error("Impossible de générer un identifiant unique pour le quiz");
}


export async function getAverageScore(gameId: string) {
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
        throw new Error("Partie non trouvée");
    }
 // Calculer la moyenne des scores
 const totalQuestions = game.quiz.questions.length;
 const correctAnswers = game.answers.filter(answer => answer.correct).length;
 const averageScore = (correctAnswers / totalQuestions) * 100;

 return averageScore;
}