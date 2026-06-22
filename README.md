# LuminaDx

> An AI-assisted clinical decision support system for Autoimmune Hepatitis (AIH), because relying solely on human doctors is a statistically dangerous game.

Live Demo Link: https://luminadx-aih-diagnostic-platform.onrender.com

## ✨ Features
* **Deterministic IAIHG Scoring:** Does the math so we don't have to.
* **Gemini AI Integration:** Generates clinical narratives and recommendations.
* **PDF Report Generation:** Creates structured clinical handoff documents via `PDFKit`.
* **Stateless-ish Session Management:** Uses in-memory session storage so patient data disappears into the void when the server restarts.

## Tech Stack
* **Backend:** Node.js, Express.js
* **Frontend:** Vanilla JavaScript, HTML, CSS 
* **AI:** Google GenAI SDK (Gemini 2.5 Flash)
* **Utilities:** Multer (file uploads), Express-Session, PDFKit

## Installation

If you're a recruiter reading this, please just click the Live Demo link at the top. If you're someone who wants to run this locally, proceed:

1.  Clone the repository:
    ```bash
    git clone https://github.com/akshaybankar007/LuminaDx.git
    cd LuminaDx
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file in the root directory. Add your API keys, unless you expect me to pay for your compute:
    ```env
    GEMINI_API_KEY=your_gemini_api_key_here
    SESSION_SECRET=literally_any_random_string
    PORT=3000
    NODE_ENV=development
    ```
4.  Start the server:
    ```bash
    npm start
    ```
5.  Open `http://localhost:3000` and pretend to be a hepatologist or whatever.

## ⚠️ Disclaimer
FOR CLINICAL DECISION SUPPORT ONLY. Not a substitute for physician judgment. If you use this to diagnose yourself and something goes wrong, that's entirely a 'you' problem.

---
*Built by [Akshay Bankar](https://github.com/akshaybankar007).*