import { Request, Response } from 'express';
import { assert, string } from 'superstruct';

import * as userUtils from '../utils/userUtils';
import { table } from 'console';

class HttpError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

const MODEL = process.env.MODEL

let tabCompletionUser: number[] = []

export async function generateCompletion(req: Request, res: Response) {
    try {
        const question = req.body.question;
        const theme = req.body.theme;

        assert(question, string());
        assert(theme, string());

        const user = await userUtils.getUser(req);
        
        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 404);
        }
    
        // Vérification de la taille des champs
        if (question.length > 100 || theme.length > 100) {
            throw new HttpError("Les champs ne peuvent pas dépasser 100 caractères", 400);
        }

        const url = 'http://ollama:11434/api/generate';

        let systemPrompt = '';

        switch(theme) {
            case 'standard':
                systemPrompt = 
                `Tu recevras une question. 
                Génère 4 réponses possibles, dont la première est correcte. 
                Assure-toi que chaque réponse soit unique et ne dépasse pas 50 caractères.`;
                break;
            case 'humor':
                systemPrompt = 
                `Tu recevras une question. 
                Génère 4 réponses sous forme de blagues, la première étant correcte. 
                Assure-toi que chaque réponse soit unique et ne dépasse pas 50 caractères.`;
                break;
            case 'mix':
                systemPrompt = 
                `Tu recevras une question. 
                Génère 4 réponses mêlant humour et réalisme, la première étant correcte. 
                Assure-toi que chaque réponse soit unique et ne dépasse pas 50 caractères.`;
                break;
            default:
                throw new HttpError("Thème invalide", 400);
        }        

        if (tabCompletionUser.includes(user.id)) {
            throw new HttpError("Un seul appel à la fois est autorisé", 400);
        }
        else
        {
            tabCompletionUser.push(user.id)
        }

        const data = {  
            model: MODEL,
            system: systemPrompt,
            prompt: `Question: ${question}`,
            format: {
                properties: {
                    answer1: {
                        type: "string"
                    },
                    answer2: {
                        type: "string"
                    },
                    answer3: {
                        type: "string"
                    },
                    answer4: {
                        type: "string"
                    }
                },
                required: [
                    "answer1",
                    "answer2",
                    "answer3",
                    "answer4",
                ]
            },
            stream: false,
            temperature: 0.5,
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });     
    
        if (!response.ok) {
            throw new HttpError("L'intelligence artificielle n'est pas disponible", 500);
        }
    
        const completion = await response.json();

        const output = JSON.parse(completion.response);Error

        const answers = [output.answer1, output.answer2, output.answer3, output.answer4];

        tabCompletionUser = tabCompletionUser.filter(e => e !== user.id);

        res.status(200).json({answers: answers});

    } catch (error: any) {
        if (error instanceof HttpError) {
            if(error.status === 500) {
                // On retire tous les utilisateurs de la liste
                tabCompletionUser = []
            }

            res.status(error.status).json({error: error.message});
        }
        else {
            res.status(500).json({error: "Erreur interne"});
            // On retire tous les utilisateurs de la liste
            tabCompletionUser = []
        }
    }
  }