import { prisma } from "../model/db";
import { Request, Response } from "express";
import { assert, string } from "superstruct";

import * as userUtils from "../utils/userUtils";
import * as timerUtils from "../utils/timerUtils";

class HttpError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

export async function listen(req: Request, res: Response) {
    try{
        const gameId = req.params.id;
        const token = req.query.token;

        assert(gameId, string());
        assert(token, string());

        req.headers.token = token;

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

        if(!timerUtils.timers[gameId].active) {
            throw new HttpError("Aucun timer actif pour cette partie", 404);
        }

        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Connection', 'keep-alive');

        let interval = setInterval(() => {
            if (timerUtils.timers[gameId].active){
                res.write(`data: ${JSON.stringify({ time: timerUtils.timers[gameId].remainingTime })}\n\n`);
                
                if (timerUtils.timers[gameId].remainingTime === 0) {
                    timerUtils.timers[gameId].active = false;
                    res.end();
                    clearInterval(interval);
                }
            } 
            else {
                res.end();
                clearInterval(interval);
            }
        }, 1000);
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
