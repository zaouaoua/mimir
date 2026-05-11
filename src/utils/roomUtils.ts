import { Question, Room, RoomPlayer } from "@prisma/client";
import { prisma } from "../model/db";
import * as timerUtils from "./timerUtils";

export let sseClients: Record<string, any[]> = {};
let intervals: Record<string, NodeJS.Timeout> = {};

export function addClientToSSE(gameId: string, client: any): void {
    if (!sseClients[gameId]) {
        sseClients[gameId] = [];
    }
    sseClients[gameId].push(client);
}

export function removeClientFromSSE(gameId: string, client: any): void {
    if (sseClients[gameId]) {
        sseClients[gameId] = sseClients[gameId].filter(c => c !== client);

        // Si aucun client n'est connecté, arrêter l'intervalle
        if (sseClients[gameId].length === 0) {
            clearInterval(intervals[gameId]);
            delete intervals[gameId];
        }
    }
}

export async function start(roomId: string) {
    const room = await prisma.room.findUnique({
        where: {
            id: roomId
        },
        include: {
            quiz: {
                include: {
                    questions: true
                }
            }
        }
    });

    if (!room) {
        throw new Error("Partie non trouvée");
    }

    // Attendre 2 secondes avant de lancer la partie
    await new Promise(resolve => setTimeout(resolve, 2000));

    await prisma.room.update({
        where: {
            id: room.id
        },
        data: {
            launched: true
        }
    });

    // Envoyer un événement SSE pour informer tous les joueurs de la première question
    if (sseClients[roomId]) {
        sseClients[roomId].forEach(client => {
            client.res.write(`data: ${JSON.stringify({ eventType: "gameStart" })}\n\n`);
        });

        // Attendre 500 millisecondes avant d'envoyer les informations du quiz
        await new Promise(resolve => setTimeout(resolve, 500));

        // Envoyer les informations du quiz
        sseClients[roomId].forEach(client => {
            client.res.write(`data: ${JSON.stringify({ eventType: "quizInfos", totalQuestion: room.quiz.questions.length })}\n\n`);
        });

        if (room.gameMode === "team"){
            startRoomTimer(roomId);
        }
    }
}

export async function nextQuestion(roomId: string) {

    const room = await prisma.room.findUnique({
        where: {
            id: roomId
        },
        include: {
            quiz: {
                include: {
                    questions: true
                }
            }
        }
    });

    if (!room) {
        throw new Error("Partie non trouvée");
    }

    //Check if there are question left
    if (room.quiz.questions.length === room.questionCursor + 1) {

        // Send SSE event for game end after 3 seconds
        setTimeout(async () => {
            if (sseClients[roomId]) {
                sseClients[roomId].forEach(client => {
                    client.res.write(`data: ${JSON.stringify({ eventType: "gameEnd" })}\n\n`);
                });
            }
        }, 3000);
    }
    else {
        // Wait 3 seconds before moving to next question
        setTimeout(async () => {
            await prisma.room.update({
                where: {
                    id: room.id
                },
                data: {
                    questionCursor: { increment: 1 }
                }
            });

            await prisma.roomPlayer.updateMany({
                where: {
                    roomId: room.id
                },
                data: {
                    answered: false
                }
            });

            // Send SSE event for next question
            if (sseClients[roomId]) {
                sseClients[roomId].forEach(client => {
                    client.res.write(`data: ${JSON.stringify({ eventType: "nextQuestion" })}\n\n`);
                });

                if (room.gameMode === "team"){
                    startRoomTimer(roomId);
                }
            }
        }, 3000);
    }
}

export async function startRoomTimer(roomId: string) {

    const room = await prisma.room.findUnique({
        where: {
            id: roomId
        }
    });

    if (!room) {
        throw new Error("Partie non trouvée");
    }

    let duration = 0;

    switch (room.difficulty) {
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

    timerUtils.timers[roomId] = { remainingTime: duration, active: true, timer: 
        setInterval(async () => {
            timerUtils.timers[roomId].remainingTime --;

            for (const client of sseClients[roomId]) {
                client.res.write(`data: ${JSON.stringify({ eventType: "timer", remainingTime: timerUtils.timers[roomId].remainingTime })}\n\n`);
            }

            if (timerUtils.timers[roomId].remainingTime === 0) {
                nextQuestion(roomId);
                clearInterval(timerUtils.timers[roomId].timer);
            }
        }, 1000)
    };
}

export async function interruptRoomTimer(roomId: string): Promise<void> {
    timerUtils.timers[roomId].active = false;
    clearTimeout(timerUtils.timers[roomId].timer);
}
import { Response } from 'express';

export async function sendGameLaunchedInfo(res: Response, room: Room & { quiz: { questions: Question[] } }, existingPlayer: RoomPlayer) {
    res.write(`data: ${JSON.stringify({ eventType: "gameStart" })}\n\n`);
    // Attendre 500 millisecondes avant d'envoyer les informations du quiz
    await new Promise(resolve => setTimeout(resolve, 500));
    res.write(`data: ${JSON.stringify({ eventType: "quizInfos", totalQuestion: room.quiz.questions.length, currentQuestion: room.questionCursor, score: existingPlayer?.score })}\n\n`);
}