import { prisma } from "../model/db";
import e, { Request, Response } from "express";
import { assert, object, string, refine } from "superstruct";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import * as userUtils from '../utils/userUtils';
import crypto from 'crypto';
import validator from 'validator';
import { getPublicBaseUrl, sendMail } from '../utils/email';

class HttpError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

const Name = refine(string(), 'name', value => {
    if (value.length < 3) {
        throw new HttpError('Nom invalide', 400);
    }
    return true;
});

const Email = refine(string(), 'email', value => {
    if (!validator.isEmail(value)) {
        throw new HttpError('Email invalide', 400);
    }
    return true;
});

const CreateUserSchema = object({
    name: Name,
    email: Email,
    password: string()
});

const LoginSchema = object({
    name: Name,
    password: string()
});

const VerifyEmailSchema = object({
    token: string()
});

const ForgotPasswordSchema = object({
    email: Email,
});

const ResetPasswordSchema = object({
    token: string(),
    password: string(),
});

function sha256Hex(input: string) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function sendVerificationEmail(toEmail: string, token: string) {
    const baseUrl = getPublicBaseUrl();
    const link = `${baseUrl}/user/verify-email?token=${encodeURIComponent(token)}`;

    await sendMail({
        to: toEmail,
        subject: 'Valide ton email',
        text: `Bienvenue !\n\nClique sur ce lien pour valider ton email :\n${link}\n\nSi tu n'es pas à l'origine de cette demande, ignore ce message.`,
    });
}

async function sendResetPasswordEmail(toEmail: string, token: string) {
    const baseUrl = getPublicBaseUrl();
    const link = `${baseUrl}/user/reset-password?token=${encodeURIComponent(token)}`;

    await sendMail({
        to: toEmail,
        subject: 'Réinitialisation de mot de passe',
        text: `Tu as demandé à réinitialiser ton mot de passe.\n\nClique sur ce lien :\n${link}\n\nCe lien expire bientôt. Si tu n'es pas à l'origine de cette demande, ignore ce message.`,
    });
}

export async function create(req: Request, res: Response) {
    try {
        assert(req.body, CreateUserSchema);

        const { name, email, password } = req.body;

        if (password.length < 8) {
            throw new HttpError("Le mot de passe doit contenir au moins 8 caractères", 400);
        }

        if (await prisma.user.findUnique({ where: { userName: name } })) {
            throw new HttpError("Ce nom est déjà utilisé", 400);
        }

        const existingEmail = await prisma.user.findUnique({ where: { email } });
        if (existingEmail) {
            throw new HttpError("Cet email est déjà utilisé", 400);
        }

        const verificationToken = generateToken();
        const verificationTokenHash = sha256Hex(verificationToken);
        const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const user = await prisma.user.create({ 
            data: {
                userName: name,
                email,
                emailVerified: false,
                emailVerificationTokenHash: verificationTokenHash,
                emailVerificationTokenExpiresAt: verificationExpiresAt,
                password: await bcrypt.hash(password, 10)
            }
        });

        // Fire-and-forget sending email; registration should still succeed even if SMTP isn't configured.
        await sendVerificationEmail(email, verificationToken);

        return res.status(201).json({ emailVerificationRequired: true });
    }
    catch (error: any) 
    {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(400).json({ error: error.message });
        }
    }
}

export async function login(req: Request, res: Response) {
    try {
        assert(req.body, LoginSchema);

        const { name, password } = req.body;


        if (password.length < 8) {
            throw new HttpError("Le mot de passe doit contenir au moins 8 caractères", 400);
        }

        const user = await prisma.user.findUnique({
            where: {
                userName: name
            }
        });

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        if (user.email && !user.emailVerified) {
            throw new HttpError("Veuillez valider votre email", 403);
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            throw new HttpError("Mot de passe incorrect", 401);
        }

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!);

        return res.json({ token });
    }
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(400).json({ error: error.message });
        }
    }
}

export async function verifyEmail(req: Request, res: Response) {
    try {
        const token = String(req.query.token ?? req.body?.token ?? '');
        assert({ token }, VerifyEmailSchema);

        const tokenHash = sha256Hex(token);

        const user = await prisma.user.findFirst({
            where: {
                emailVerificationTokenHash: tokenHash,
                emailVerificationTokenExpiresAt: { gt: new Date() },
            },
        });

        if (!user) {
            throw new HttpError('Lien invalide ou expiré', 400);
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                emailVerified: true,
                emailVerificationTokenHash: null,
                emailVerificationTokenExpiresAt: null,
            },
        });

                if (String(req.headers.accept || '').includes('text/html')) {
                        return res
                                .status(200)
                                .type('html')
                                .send('<h2>Email validé ✅</h2><p>Tu peux retourner sur l\'application et te connecter.</p>');
                }

                return res.json({ ok: true });
    } catch (error: any) {
        if (error instanceof HttpError) {
                        if (String(req.headers.accept || '').includes('text/html')) {
                                return res.status(error.status).type('html').send(`<h2>Erreur</h2><p>${error.message}</p>`);
                        }
                        return res.status(error.status).json({ error: error.message });
        }
                if (String(req.headers.accept || '').includes('text/html')) {
                        return res.status(400).type('html').send(`<h2>Erreur</h2><p>${error.message}</p>`);
                }
        return res.status(400).json({ error: error.message });
    }
}

export async function resetPasswordPage(req: Request, res: Response) {
        const token = String(req.query.token ?? '');

        // Minimal HTML page used by the email link.
        return res.type('html').send(`<!doctype html>
<html lang="fr">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Réinitialiser le mot de passe</title>
</head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;max-width:520px;margin:40px auto;padding:0 16px;">
    <h2>Réinitialiser le mot de passe</h2>
    <p>Choisis un nouveau mot de passe (8 caractères minimum).</p>

    <form id="form">
        <label style="display:block;margin:12px 0 6px;">Nouveau mot de passe</label>
        <input id="password" type="password" minlength="8" required style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;" />
        <button type="submit" style="margin-top:14px;padding:10px 14px;border:0;border-radius:8px;background:#2563eb;color:white;cursor:pointer;">Valider</button>
    </form>

    <pre id="out" style="margin-top:18px;white-space:pre-wrap;"></pre>

    <script>
        const token = ${JSON.stringify(token)};
        const out = document.getElementById('out');
        document.getElementById('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            out.textContent = 'En cours...';
            const password = document.getElementById('password').value;
            try {
                const resp = await fetch('/user/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, password }),
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) {
                    out.textContent = data.error || 'Erreur';
                    return;
                }
                out.textContent = 'Mot de passe mis à jour ✅ Tu peux retourner sur l\'application.';
            } catch (err) {
                out.textContent = String(err);
            }
        });
    </script>
</body>
</html>`);
}

export async function resendVerification(req: Request, res: Response) {
    try {
        assert(req.body, ForgotPasswordSchema);
        const { email } = req.body;

        const user = await prisma.user.findUnique({ where: { email } });

        // Always return ok to avoid account enumeration
        if (!user || !user.email || user.emailVerified) {
            return res.json({ ok: true });
        }

        const verificationToken = generateToken();
        const verificationTokenHash = sha256Hex(verificationToken);
        const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                emailVerificationTokenHash: verificationTokenHash,
                emailVerificationTokenExpiresAt: verificationExpiresAt,
            },
        });

        await sendVerificationEmail(user.email, verificationToken);

        return res.json({ ok: true });
    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(400).json({ error: error.message });
    }
}

export async function forgotPassword(req: Request, res: Response) {
    try {
        assert(req.body, ForgotPasswordSchema);
        const { email } = req.body;

        const user = await prisma.user.findUnique({ where: { email } });
        // Always return ok to avoid account enumeration
        if (!user || !user.email) {
            return res.json({ ok: true });
        }

        const resetToken = generateToken();
        const resetTokenHash = sha256Hex(resetToken);
        const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordResetTokenHash: resetTokenHash,
                passwordResetTokenExpiresAt: resetExpiresAt,
            },
        });

        await sendResetPasswordEmail(user.email, resetToken);

        return res.json({ ok: true });
    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(400).json({ error: error.message });
    }
}

export async function resetPassword(req: Request, res: Response) {
    try {
        assert(req.body, ResetPasswordSchema);
        const { token, password } = req.body;

        if (password.length < 8) {
            throw new HttpError("Le mot de passe doit contenir au moins 8 caractères", 400);
        }

        const tokenHash = sha256Hex(token);
        const user = await prisma.user.findFirst({
            where: {
                passwordResetTokenHash: tokenHash,
                passwordResetTokenExpiresAt: { gt: new Date() },
            },
        });

        if (!user) {
            throw new HttpError('Lien invalide ou expiré', 400);
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: await bcrypt.hash(password, 10),
                passwordResetTokenHash: null,
                passwordResetTokenExpiresAt: null,
            },
        });

        return res.json({ ok: true });
    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(400).json({ error: error.message });
    }
}

export async function infos(req: Request, res: Response) {
    try {
        const token = req.headers.token;

        if (!token) {
            return res.status(401).json({ error: "Token manquant" });
        }

        const decoded = jwt.verify(String(token), process.env.JWT_SECRET!) as { userId: number };

        if (!decoded || !decoded.userId) {
            return res.status(401).json({ error: "Token invalide" });
        }

        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                userName: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }

        return res.json({ user });
    }
    catch (error: any) {
        return res.status(400).json({ error: error.message });
    }
}

export async function createdQuizs(req: Request, res: Response) {
    try {
        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        // Récupérer les quizs créés par l'utilisateur + le nombre de questions et pas les questions
        
        const quizzes = await prisma.quiz.findMany({
            where: {
                userId: user.id
            },
            select: {
                id: true,
                title: true,
                category: true,
                difficulty: true,
                public: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: {
                        questions: true
                    }
                }
            }
        });
        const result = quizzes.map(quiz => ({
            id: quiz.id,
            title: quiz.title,
            category: quiz.category,
            difficulty: quiz.difficulty,
            public: quiz.public,
            createdAt: quiz.createdAt,
            updatedAt: quiz.updatedAt,
            numberOfQuestions: quiz._count.questions
        }));

        return res.status(200).json(result);
    } 
    catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        else {
            return res.status(400).json({ error: error.message });
        }
    }
}

export async function games(req: Request, res: Response) {
    try {
        const user = await userUtils.getUser(req);

        if (!user) {
            throw new HttpError("Utilisateur non trouvé", 401);
        }

        const games = await prisma.game.findMany({
            where: {
                userId: user.id
            }
        });

        return res.json({ games });
    } 
    catch (error: any) {
        return res.status(400).json({ error: error.message });
    }
}