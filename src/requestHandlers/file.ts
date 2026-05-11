import e, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as fileUtils from "../utils/fileUtils";
import * as userUtils from "../utils/userUtils";
import { prisma } from '../model/db';
import { assert } from 'superstruct';
import { string } from "superstruct";
import { User } from '@prisma/client';


class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
      super(message);
      this.status = status;
  }
}

// Set storage engine for Multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const user = await userUtils.getUser(req);
    if (!user) {
      return cb(new Error('Utilisateur non authentifié'), '');
    }

    const userDir = `uploads/${user.userName}_${user.id}`;
    fs.mkdirSync(userDir, { recursive: true });

    if (!fileUtils.FileDirMaxSize(userDir)) {
      return cb(new Error('Limite de taille du répertoire atteinte'), '');
    }

    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const filename = `${Date.now()}${path.extname(file.originalname)}`;
    cb(null, filename);
  }
});

// Initialize Multer upload
const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    fileUtils.checkFileType(file, cb);
  }
});

export async function uploadFile(req: Request, res: Response) {
  const user = await userUtils.getUser(req);

  if (!user) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  upload.single('file')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    
    // Si le fichier est téléchargé avec succès
    if (!req.file) {
      return res.status(400).json({ error: 'Fichier non uploadé' });
    }

    // Extraire le nom du fichier à partir du chemin complet
    const filename = path.basename(req.file.path);

    return res.status(200).json({ message: 'Fichier enregistré avec succès', filePath: filename });
  });
}

export async function downloadFileGame(req: Request, res: Response) {
  const id = req.params.id;
  const gameId = req.params.id;


  const answer = req.body.question;

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

  const questionCursor = game.questionCursor;
  if (questionCursor !== game.quiz.questions.length) {
    const currentQuestion = game.quiz.questions[questionCursor];
    const userId = game.quiz.userId;

    if (userId === null) {
      throw new HttpError("User ID is null", 400);
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userId
      }
    });

    if (!user) {
      throw new HttpError("User not found", 404);
    }


    // verifie si le answer est bien dans les choix de la question

    const choices = [currentQuestion.correctAnswer, currentQuestion.falseAnswer1, currentQuestion.falseAnswer2, currentQuestion.falseAnswer3].filter(Boolean);
    if (!choices.includes(answer)) {
      throw new HttpError("Réponse invalide", 400);
    }



    if (currentQuestion.type === 'image' || currentQuestion.type === 'audio') {

      const userDir = `uploads/${user.userName}_${user.id}`;
      const files = fs.readdirSync(userDir);

      let fileFound = false;
      const file = files.find(file => file.startsWith(id));
      const filePath = path.join(userDir, answer);



      if (file) {
        res.sendFile(filePath);
        fileFound = true;
      }

if (!fileFound) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }


  }
  else {
    throw new HttpError("La question courante n'est pas un fichier", 400);
}
  }
  else 
  {
    throw new HttpError("La partie est terminée", 400);
  }


}


export async function downloadFile(req: Request, res: Response) {
  const user = await userUtils.getUser(req);

  if (!user) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  const fileName = req.params.fileName;
  const userDir = `uploads/${user.userName}_${user.id}`;
  const filePath = path.join(userDir, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Fichier non trouvé' });
  }

  res.sendFile(filePath);
}




export async function downloadFileU(req: Request, res: Response) {

  const user = await userUtils.getUser(req);
  if (!user) {
    return cb(new Error('Utilisateur non authentifié'), '');
  }

  const userDir = `uploads/${user.userName}_${user.id}`;
  
  const id = req.params.id;
  const baseDirectoryPath = path.join(__dirname, '../../uploads');


  fs.readdir(baseDirectoryPath, (err, userDirs) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    let fileFound = false;

    for (const userDir of userDirs) {
      const directoryPath = path.join(baseDirectoryPath, userDir);
      const files = fs.readdirSync(directoryPath);

      const file = files.find(file => file.startsWith(id));
      if (file) {
        const filePath = path.join(directoryPath, file);
        res.sendFile(filePath);
        fileFound = true;
        break;
      }
    }

    if (!fileFound) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }
  });
}


export async function downloadAllFiles(req: Request, res: Response) {
  const user = await userUtils.getUser(req);

  if (!user) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  const userDir = `uploads/${user.userName}_${user.id}`;

  if (!fs.existsSync(userDir)) {
    return res.status(404).json({ error: 'Aucun fichier trouvé pour cet utilisateur' });
  }

  const files = fs.readdirSync(userDir);
  const acceptedExtensions = ['.jpeg', '.jpg', '.png', '.mp3', '.mpeg'];
  const filteredFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return acceptedExtensions.includes(ext);
  });

  const fileUrls = filteredFiles.map(file => {
    return {
      fileName: file,
      url: `${req.protocol}://${req.get('host')}/download/${file}`
    };
  });

  return res.status(200).json({ files: fileUrls });
}
export async function deleteFile(req: Request, res: Response) {
  const user = await userUtils.getUser(req);

  if (!user) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  const fileName = req.params.fileName;
  if (!fileName) {
    return res.status(400).json({ error: 'Nom du fichier non fourni' });
  }

  const userDir = `uploads/${user.userName}_${user.id}`;
  const filePath = path.join(userDir, fileName);


  const userQuiz = await prisma.quiz.findMany({
    where: {
      userId: user.id
    },
    include: {
      questions: true
    }
  });

  for (const quiz of userQuiz) {

    for (const question of quiz.questions) {
      if (question.type === 'image' || question.type === 'audio') {
        const choices = [question.correctAnswer, question.falseAnswer1, question.falseAnswer2, question.falseAnswer3].filter(Boolean);
        if (choices.includes(fileName)) {
          return res.status(400).json({ error: 'Fichier utilisé dans une question' });
        }
      }
    }
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Fichier non trouvé' });
  }
  
  fs.unlink(filePath, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    return res.status(200).json({ message: 'Fichier supprimé avec succès' });
  });
}

function cb(arg0: Error, arg1: string) {
  throw new Error('Function not implemented.');
}


export function cloneFile(filePath: string, dirsrc : string , dirtarget : string): void {
  const srcPath = path.join( dirsrc, filePath);
  const destPath = path.join(dirtarget, filePath);

if  (srcPath == destPath) {  
  return;
}

if (!fs.existsSync(srcPath)) {
  throw new Error('Fichier source non trouvé');
}

if (fs.existsSync(destPath)) {
  return;
}
fs.mkdirSync(destPath, { recursive: true });
  fs.copyFileSync(srcPath, destPath);
}