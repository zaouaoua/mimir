import { decode } from 'html-entities';

// Fonction qui permet de décoder une chaîne de caractères HTML
function decodeHtml(html: string): string {
    return decode(html);
}

// Fonction qui permet de récupérer des questions depuis l'API OpenTDB
export async function fetchQuestions(amount: string, category?: string, difficulty?: string) {
    let url = `https://opentdb.com/api.php?amount=${amount}`;

    if (category) {
        url += `&category=${category}`;
    }

    if (difficulty) {
        url += `&difficulty=${difficulty}`;
    }

    const response = await fetch(url);

    const data = await response.json();

    if (data.response_code !== 0) {
        throw new Error("pas de question disponible");
    }

    data.results.forEach((item: any) => {
        item.question = decodeHtml(item.question);
        item.correct_answer = decodeHtml(item.correct_answer);
        item.incorrect_answers = item.incorrect_answers.map((answer: string) => decodeHtml(answer));
    });

    return data.results;
}
