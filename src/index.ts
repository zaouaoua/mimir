import cors from 'cors';
import express, { Request, Response } from "express";

import * as quiz from './requestHandlers/quiz';
import * as game from './requestHandlers/game';
import * as user from './requestHandlers/user';
import * as file from './requestHandlers/file';
import * as timer from './requestHandlers/timer';
import * as room from './requestHandlers/room';
import * as ollama from './requestHandlers/ollama';

const app = express();
const PORT = 3000;
const PROTOCOL = process.env.PROTOCOL || 'HTTP'; // 'http' par défaut
const DOMAIN = process.env.DOMAIN || 'localhost'; // 'localhost' par défaut

const fs = require('fs');
const https = require('https');

app.use(cors());

app.use(express.json());

// Route post de l'API pour créer un quiz
app.post("/quiz", async (req: Request, res: Response) => {
  quiz.create(req, res);
});

app.get("/quiz/:id/retrieve", async (req: Request, res: Response) => {
  quiz.retrieve(req, res);
});

app.post("/quiz/:id/edit", async (req: Request, res: Response) => {
  quiz.edit(req, res);
});

app.get("/quiz/:id/publish", async (req: Request, res: Response) => {
  quiz.publish(req, res);
});

//Route pour pouvoir jouer à un quiz
app.get("/quiz/:id/play", async (req: Request, res: Response) => {
  game.create(req, res);
});


app.get("/game/:id/restart", async (req: Request, res: Response) => {
  game.restart(req, res);
});

// Route get de l'API pour obtenir la question courante
app.get("/game/:id/question", async (req: Request, res: Response) => {
  game.currentQuestion(req, res);
});

// Route post de l'API pour vérifier la réponse à la question courante
app.post("/game/:id/answer", async (req: Request, res: Response) => {
  game.verifyCurrentQuestionAnswer(req, res);
});

// Route get de l'API pour obtenir les informations du quiz
app.get("/game/:id/infos", async (req: Request, res: Response) => {
  game.infos(req, res);
});

// Route get de l'API pour obtenir une liste de quiz
app.get("/quiz/list", async (req: Request, res: Response) => {
  quiz.list(req,res);
});

// Route pour cloner un quiz
app.get('/quiz/:id/clone', async (req: Request, res: Response) => {
  quiz.clone(req, res);
});

// Route get de l'API pour crée un quiz Rapid 
app.get("/quizFast", async (req: Request, res: Response) => {
  quiz.fastCreate(req, res);
});



app.delete("/quiz/:id/delete", async (req: Request, res: Response) => {
  quiz.deleteQuiz(req, res);
});

//Route get pour obtenir la moyenne  de score d'un quiz
app.get("/game/:id/score", async (req: Request, res: Response) => {
  quiz.score(req, res);
});


//Route get pour obtenir la moyenne d'un quiz
app.get("/game/:id/average", async (req: Request, res: Response) => {
  game.average(req, res);
});

app.get('/game/:id/timer', (req: Request, res: Response) => {
  timer.listen(req, res);
});


app.delete("/game/:id/delete", async (req: Request, res: Response) => {
  game.deleteGame(req, res);
});

// Route get de l'API pour obtenir une liste de quiz jouer par un utilisateur

app.get("/quiz/user/game", async (req: Request, res: Response) => {
  user.games(req, res);
});

//Route get de l'api pour recuperer les quiz crée de l'utilisateur
app.get("/quiz/user/create", async (req: Request, res: Response) => {
  user.createdQuizs(req, res);
});

app.post('/user/register', (req: Request, res: Response) => {
  user.create(req, res);
});

app.post('/user/login', (req: Request, res: Response) => {
  user.login(req, res);
});

app.get('/user/verify-email', (req: Request, res: Response) => {
  user.verifyEmail(req, res);
});

app.post('/user/resend-verification', (req: Request, res: Response) => {
  user.resendVerification(req, res);
});

app.post('/user/forgot-password', (req: Request, res: Response) => {
  user.forgotPassword(req, res);
});

app.get('/user/reset-password', (req: Request, res: Response) => {
  user.resetPasswordPage(req, res);
});

app.post('/user/reset-password', (req: Request, res: Response) => {
  user.resetPassword(req, res);
});

app.get('/user/infos', (req: Request, res: Response) => {
  user.infos(req, res);
});

app.get('/listen/timer', (req: Request, res: Response) => {
  timer.listen(req, res);
});

app.post("/room/:id/create", async (req: Request, res: Response) => {
  room.create(req, res);
});

app.get("/room/:id/join", async (req: Request, res: Response) => {
  room.join(req, res);
});

app.get("/room/:id/start", async (req: Request, res: Response) => {
  room.start(req, res);
});

app.get("/room/:id/joinTeam", async (req: Request, res: Response) => {
  room.joinTeam(req, res);
});

app.get("/room/:id/question", async (req: Request, res: Response) => {
  room.currentQuestion(req, res);
});

app.post("/room/:id/answer", async (req: Request, res: Response) => {
  room.verifyAnswer(req, res);
});

app.get("/room/:id/scores", async (req: Request, res: Response) => {
  room.scores(req, res);
});

app.post("/ai/generate", async (req: Request, res: Response) => {
  ollama.generateCompletion(req, res);
});


if (PROTOCOL === 'HTTPS') {
  // Configuration du serveur HTTPS
  const sslOptions = {
    key: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/privkey.pem`, 'utf8'),
    cert: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/fullchain.pem`, 'utf8'),
  };

  // Créer un serveur HTTPS
  https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`🚀 Serveur HTTPS lancé sur https://${DOMAIN}:${PORT}`);
  });
} else {
  // Créer un serveur HTTP
  app.listen(PORT, () => {
    console.log(`🚀 Serveur HTTP lancé sur http://${DOMAIN}:${PORT}`);
  });
}


app.post('/uploads', (req: Request, res: Response) => {
  file.uploadFile(req, res);
});

app.post('/download/:id', (req: Request, res: Response) => {
  file.downloadFileGame(req, res);
});


app.get('/download/:id', (req: Request, res: Response) => {
  file.downloadFileU(req, res);
});



app.get('/downloadall', (req: Request, res: Response) => {
  file.downloadAllFiles(req, res);
});

app.delete('/delete/:fileName', (req: Request, res: Response) => {
  file.deleteFile(req, res);
});