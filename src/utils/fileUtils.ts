import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response } from 'express';
import * as userUtils from "../utils/userUtils";

const MAX_DIR_SIZE = 2 * 1024 * 1024; // Taille maximale du répertoire en octets (par exemple, 50 Mo)

  //regard taille du dossier de l'utilisateur

// Check file type
export function checkFileType(file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const filetypes = /jpeg|mp3|mpeg|jpg|png/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }
}

export function determineFileType(filePath: string | null): string {
    if (!filePath) return "text";
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".jpeg" || ext === ".jpg" || ext === ".png") {
        return "image";
    } else if (ext === ".mp3" || ext === ".wav") {
        return "audio";
    } else {
        return "text";
    }
}


export function FileDirMaxSize(dirPath: string): boolean {
  let totalSize = 0;

  function calculateDirectorySize(directory: string) {
    const files = fs.readdirSync(directory);

    for (const file of files) {
      const filePath = path.join(directory, file);
      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        calculateDirectorySize(filePath);
      } else {
        totalSize += stats.size;
      }
    }
  }

  calculateDirectorySize(dirPath);

  return totalSize <= MAX_DIR_SIZE;
}