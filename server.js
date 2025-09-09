// server.js
const express = require('express');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// Endpoint para el OCR
app.post('/api/ocr', upload.single('tarjetaTNE'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ninguna imagen.' });
    }

    try {
        const imagePath = path.join(__dirname, req.file.path);
        const { data: { text } } = await Tesseract.recognize(
            imagePath,
            'spa',
            { logger: m => console.log(m) }
        );

        fs.unlinkSync(imagePath); // Elimina el archivo temporal

        // Busca el RUT en el texto extraído
        const rutRegex = /([0-9]{1,2}\.[0-9]{3}\.[0-9]{3}-[0-9Kk])/;
        const rutMatch = text.match(rutRegex);
        const rut = rutMatch ? rutMatch[0] : null;

        if (rut) {
            res.json({ success: true, rut });
        } else {
            res.status(400).json({ success: false, error: 'No se pudo encontrar un RUT en la imagen.' });
        }

    } catch (error) {
        console.error('Error durante el proceso de OCR:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// Endpoint de prueba para verificar si el servidor funciona
app.get('/', (req, res) => {
  res.send('El servidor de backend está funcionando correctamente.');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor de backend escuchando en http://localhost:${PORT}`));