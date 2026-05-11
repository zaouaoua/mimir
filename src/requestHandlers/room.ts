import { prisma } from "../model/db";
import { Request, Response } from "express";
import { assert, integer, string } from "superstruct";

import * as userUtils from "../utils/userUtils";
import * as gameUtils from "../utils/gameUtils";
import * as roomUtils from "../utils/roomUtils";
import { score } from "./quiz";

class HttpError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

// Fonction pour obtenir la question courante de la partie
export async function currentQuestion(req: Request, res: Response) {
    try {
        const roomId = req.params.id;

        assert(roomId, string());

        const room = await prisma.room.findUnique({
            where: {
                id: roomId
            },
            include: {
                quiz: {
                    include: {
                        questions: true
                    }
                },
            }
        });

        if (!room) {
            throw new HttpError("Partie non trouvée !", 404);
        }

        let questionCursor = room.questionCursor;

        if (questionCursor >= room.quiz.questions.length) {
            throw new HttpError("Aucune question restante dans ce quiz.", 500);
        }

        const question = room.quiz.questions[questionCursor];

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
            answers: answers,
            type: question.type,
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

export async function verifyAnswer(req: Request, res: Response) {
    try {
        const roomId = req.params.id;
        const answer = req.body.answer;
        const user = await userUtils.getUser(req);

        assert(roomId, string());
        assert(answer, string());

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        const room = await prisma.room.findUnique({
            where: {
                id: roomId
            },
            include: {
                quiz: {
                    include: {
                        questions: true
                    }
                },
            }
        });

        if (!room) {
            throw new HttpError("Partie non trouvée", 404);
        }

        if (!room.launched) {
            throw new HttpError("La partie n'est pas encore lancée", 403);
        }

        const roomPlayer = await prisma.roomPlayer.findUnique({
            where: {
                userId_roomId: {
                    userId: user.id,
                    roomId: room.id
                }
            }
        });

        if (!roomPlayer) {
            throw new HttpError("Joueur non trouvé dans cette partie", 404);
        }

        if (roomPlayer.answered) {
            throw new HttpError("Vous avez déjà répondu à cette question", 403);
        }

        const questionCursor = room.questionCursor;

        if (questionCursor >= room.quiz.questions.length) {
            throw new HttpError("Aucune question restante dans ce quiz.", 500);
        }

        const question = room.quiz.questions[questionCursor];
        const correctAnswer = question.correctAnswer;
        const wasCorrect = answer === correctAnswer;

        await prisma.roomPlayer.update({
            where: {
                id: roomPlayer.id
            },
            data: {
                answered: true,
                score: wasCorrect ? roomPlayer.score + 1 : roomPlayer.score
            }
        });

        const roomPlayers = await prisma.roomPlayer.findMany({
            where: {
                roomId: room.id
            }
        });

        if (wasCorrect && room.gameMode === "scrum") {
            
            if (roomUtils.sseClients[roomId]) {
                roomUtils.sseClients[roomId].forEach(client => {
                    client.res.write(`data: ${JSON.stringify({ eventType: "correctAnswerFound", user: user.userName, correctAnswer: correctAnswer })}\n\n`);
                });
            }

            roomUtils.nextQuestion(roomId);
        }
        else if(roomPlayers.filter(player => player.answered).length === roomPlayers.length) {
            roomUtils.nextQuestion(roomId);

            if (room.gameMode === "team") {
                roomUtils.interruptRoomTimer(roomId);
            }
        }

        return res.status(200).json({ correctAnswer: correctAnswer });
    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
}

export async function join(req: Request, res: Response) {
    try {
        const roomId = req.params.id;
        const token = req.query.token as string;

        req.headers.token = token;

        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        const room = await prisma.room.findUnique({
            where: {
                id: roomId
            },
            include: {
                roomPlayers: true,
                quiz: {
                    include: {
                        questions: true
                    }
                }
            }
        });

        if (!room) {
            throw new HttpError("Partie non trouvée", 404);
        }

        // Vérifier si le joueur est déjà dans la partie
        const existingPlayer = await prisma.roomPlayer.findUnique({
            where: {
                userId_roomId: {
                    userId: user.id,
                    roomId: room.id
                }
            }
        });

        if (!existingPlayer) {
            //Vérifier si le playerCount est atteint
            if (room.roomPlayers.length >= room.playerCount) {
                throw new HttpError("La partie est pleine", 403);
            }

            if (room.launched) {
                throw new HttpError("La partie est déjà lancée", 403);
            }

            await prisma.roomPlayer.create({
                data: {
                    user: {
                        connect: { id: user.id }
                    },
                    room: {
                        connect: { id: room.id }
                    }
                }
            });

            // Update the roomPlayers count after adding the new player
            const updatedRoomPlayersCount = await prisma.roomPlayer.count({
                where: { roomId: room.id }
            });

            // Check if the game should start
            if (room.playerCount === updatedRoomPlayersCount && room.gameMode === "scrum") {
                roomUtils.start(roomId);
            }
        }

        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Connection', 'keep-alive');

        // Ajouter le client SSE
        roomUtils.addClientToSSE(roomId, { res });

        // Envoyer un message initial pour garder la connexion ouverte
        res.write(`data: ${JSON.stringify({ eventType: "connectionEstablished", gameMode: room.gameMode })}\n\n`);

        if(room.launched) {
            if (existingPlayer) {
                await roomUtils.sendGameLaunchedInfo(res, room, existingPlayer);
            }
        }
        else
        {

            // Envoyer la liste des joueurs à tous les clients
            const playersData = await prisma.roomPlayer.findMany({
                where: {
                    roomId: room.id
                },
                include: {
                    user: true
                }
            });

            const players = playersData.map(player => player.user.userName);

            // Envoyer la liste des joueurs à tous les clients
            roomUtils.sseClients[roomId].forEach(client => {
                client.res.write(`data: ${JSON.stringify({ eventType: "playerJoined", players })}\n\n`);
            });

            //Si en mode équipe, envoyer la liste des équipes avec les joueurs
            if (room.gameMode === "team") {
                const teamsData = await prisma.team.findMany({
                    where: {
                        roomId: room.id
                    },
                    include: {
                        players: {
                            include: {
                                user: true
                            }
                        }
                    }
                });

                const teams = teamsData.map(team => {
                    return {
                        name: team.name,
                        players: team.players.map(player => player.user.userName)
                    };
                });

                roomUtils.sseClients[roomId].forEach(client => {
                    client.res.write(`data: ${JSON.stringify({ eventType: "teams", teams })}\n\n`);
                });
            }
        }

    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
}

export async function joinTeam(req: Request, res: Response) {
    try {
        const roomId = req.params.id;
        const teamName = req.query.teamName;
        const token = req.query.token as string;

        req.headers.token = token;

        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        const room = await prisma.room.findUnique({
            where: {
                id: roomId
            },
            include: {
                teams: true
            }
        });

        if (!room) {
            throw new HttpError("Partie non trouvée", 404);
        }

        if (room.launched) {
            throw new HttpError("La partie est déjà lancée", 403);
        }

        const team = room.teams.find(team => team.name === teamName);

        if (!team) {
            throw new HttpError("Équipe non trouvée", 404);
        }

        // Vérifier si le joueur est déjà dans la partie
        const roomPlayer = await prisma.roomPlayer.findUnique({
            where: {
                userId_roomId: {
                    userId: user.id,
                    roomId: room.id
                }
            }
        });

        if (!roomPlayer) {
            throw new HttpError("Joueur non trouvé dans cette partie", 404);
        }

        // Si le joueur est déjà dans l'équipe cible, on arrête
        if (roomPlayer.teamId === team.id) {
            throw new HttpError("Le joueur est déjà dans cette équipe", 403);
        }

        // Permet au joueur de quitter son équipe actuelle et de rejoindre une nouvelle équipe
        if (roomPlayer.teamId !== null) {
            await prisma.roomPlayer.update({
                where: {
                    id: roomPlayer.id
                },
                data: {
                    teamId: null  // Retirer le joueur de l'équipe précédente
                }
            });
        }

        // Ajouter le joueur à la nouvelle équipe
        await prisma.roomPlayer.update({
            where: {
                id: roomPlayer.id
            },
            data: {
                team: {
                    connect: { id: team.id }  // Connecter le joueur à la nouvelle équipe
                }
            }
        });

        // Récupérer la liste mise à jour des équipes
        const teamsData = await prisma.team.findMany({
            where: {
                roomId: room.id
            },
            include: {
                players: {
                    include: {
                        user: true
                    }
                }
            }
        });

        const teams = teamsData.map(team => {
            return {
                name: team.name,
                players: team.players.map(player => player.user.userName)
            };
        });

        // Envoyer l'event de mise à jour des équipes à tous les clients SSE
        roomUtils.sseClients[roomId].forEach(client => {
            client.res.write(`data: ${JSON.stringify({ eventType: "teams", teams })}\n\n`);
        });

        return res.status(200).json({ message: "Équipe mise à jour avec succès", teams });

    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
}

export async function start(req: Request, res: Response) {
    try {
        const roomId = req.params.id;

        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        const room = await prisma.room.findUnique({
            where: {
                id: roomId
            },
            include: {
                roomPlayers: true
            }
        });

        if (!room) {
            throw new HttpError("Partie non trouvée", 404);
        }

        if (room.creatorId !== user.id) {
            throw new HttpError("Seul le créateur de la partie peut la lancer", 403);
        }

        if (room.launched) {
            throw new HttpError("La partie est déjà lancée", 403);
        }

        // Vérifier que tous les joueurs ont une équipe

        if (room.gameMode === "team") {
            const playersWithoutTeam = room.roomPlayers.filter(player => player.teamId === null);

            if (playersWithoutTeam.length > 0) {
                throw new HttpError("Certains joueurs n'ont pas d'équipe", 403);
            }
        }

        roomUtils.start(roomId);

        return res.status(200).json({ message: "Partie lancée" });
    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
}

export async function create(req: Request, res: Response) {
    try {
        const quizId = Number(req.params.id);
        const playerCount = Number(req.query.playerCount);
        const gameMode = req.query.gameMode as string;

        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        if (playerCount > 100){
            throw new HttpError("Nombre de joueurs maximum dépassé", 403);
        } 

        assert(quizId, integer());

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

        const roomId = await gameUtils.getUniqueId();

        const room = await prisma.room.create({
            data: {
                id: roomId,
                quiz: {
                    connect: { id: quiz.id }
                },
                creator: {
                    connect: { id: user.id }
                },
                playerCount: playerCount,
                questionCursor: 0,
                gameMode: gameMode,
            }
        });

        if (gameMode === "team") {
            const teams = req.body.teams;
            const difficulty = req.query.difficulty as string;

            await prisma.room.update({
                where: {
                    id: roomId
                },
                data: {
                    difficulty: difficulty
                }
            });

            await prisma.team.createMany({
                data: teams.map((team: any) => {
                    return {
                        name: team,
                        roomId: roomId
                    };
                })
            });
        }

        return res.status(201).json({ id: room.id });
    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
}

export async function scores(req: Request, res: Response) {
    try {
        const roomId = req.params.id;

        assert(roomId, string());

        const room = await prisma.room.findUnique({
            where: {
                id: roomId
            },
            include: {
                roomPlayers: {
                    include: {
                        user: true,
                        team: true, // On inclut l’équipe pour pouvoir faire le calcul par équipe
                    }
                },
                teams: true
            }
        });

        if (!room) {
            throw new HttpError("Partie non trouvée", 404);
        }

        // Mode "scrum" : scores individuels
        if (room.gameMode === "scrum") {
            const scores = room.roomPlayers.map(player => {
                return {
                    userName: player.user.userName,
                    score: player.score
                };
            });
            return res.status(200).json({ scores });
        }

        // Mode "team" : scores par équipe (moyenne des scores des membres)
        if (room.gameMode === "team") {

            // On regroupe les joueurs par équipe
            const scores = await Promise.all(
                room.teams.map(async (team) => {
                    const players = room.roomPlayers.filter(rp => rp.teamId === team.id);
                    const totalScore = players.reduce((acc, player) => acc + player.score, 0);
                    const avgScore = players.length > 0 ? totalScore / players.length : 0;

                    return {
                        teamName: team.name,
                        averageScore: avgScore,
                        players: players.map(p => ({
                            userName: p.user.userName,
                            score: p.score
                        }))
                    };
                })
            );

            return res.status(200).json({ scores });
        }

        // Si d’autres modes existaient
        return res.status(200).json({ message: "Mode de jeu inconnu ou non géré" });

    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
}
