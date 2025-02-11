const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { parse } = require('json2csv');
const axios = require('axios'); // Para llamadas a la API

// 🔹 Función para obtener la fecha en formato YYYY-MM-DD
const getFormattedDate = (offsetDays = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return date.toISOString().split('T')[0]; // Formato YYYY-MM-DD
};

(async () => {
    console.log("🟢 Iniciando Puppeteer...");

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

    const baseURL = "https://www.airbnb.cl/s/";
    const location = "Santiago-Centro--Santiago--Chile";
    const checkin = getFormattedDate(0);
    const checkout = getFormattedDate(8);
    const filters = `?query=Santiago%20Centro%2C%20Santiago&adults=2&checkin=${checkin}&checkout=${checkout}`;

    const searchURL = `${baseURL}${location}/homes${filters}`;
    console.log("🔎 URL generada:", searchURL);

    await page.goto(searchURL, { waitUntil: 'networkidle2', timeout: 60000 });

    console.log("✅ Página cargada correctamente.");
    console.log("⏳ Esperando carga de la paginación...");

    let currentPageUrl = searchURL;
    let allListings = new Set(); // 🔹 Se usa un Set para evitar duplicados

    // 🔹 Iniciar la iteración de páginas hasta que no haya "Siguiente"
    while (currentPageUrl) {
        console.log(`🌍 Procesando página: ${currentPageUrl}`);

        await page.goto(currentPageUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        try {
            await page.waitForSelector('a[href*="/rooms/"]', { timeout: 15000 });
        } catch (error) {
            console.warn("⚠️ No se encontraron anuncios en la página, reintentando...");
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        await new Promise(resolve => setTimeout(resolve, 5000)); // 🔹 Espera adicional

        // 🔹 Extraer los IDs de los anuncios de la página actual **sin duplicados**
        const listingIds = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href*="/rooms/"]'))
                .map(el => el.href.match(/\/rooms\/(\d+)/)?.[1])
                .filter(id => id)
                .filter((id, index, self) => self.indexOf(id) === index);
        });

        const uniqueIds = Array.from(new Set(listingIds));

        console.log(`✅ Se encontraron ${uniqueIds.length} anuncios en la página.`);

        uniqueIds.forEach(id => allListings.add(id));

        const nextPage = await page.$('nav[aria-label="Paginación de los resultados de búsqueda"] a[aria-label="Siguiente"]');
        if (nextPage) {
            currentPageUrl = await page.evaluate(el => el.href, nextPage);
        } else {
            currentPageUrl = null;
        }
    }

    console.log(`🔹 Finalizado el recorrido de páginas.`);
    console.log(`📊 Total de anuncios únicos encontrados: ${allListings.size}`);

    // 🔹 Guardar los resultados en un archivo CSV **en tiempo real**
    const fileName = `listings_${getFormattedDate()}.csv`;
    const filePath = path.join(__dirname, fileName);
    const writeStream = fs.createWriteStream(filePath, { flags: 'a' }); // 🔹 Modo `append`

    let firstBatch = true; // Para escribir el encabezado solo una vez

    // 🔹 Agrupar IDs en lotes de 5 y hacer llamadas a la API
    const chunkSize = 1;
    const allListingsArray = Array.from(allListings);

    for (let i = 0; i < allListingsArray.length; i += chunkSize) {
        const chunk = allListingsArray.slice(i, i + chunkSize);

        // 🔹 Construcción manual de la URL con los parámetros correctos
        const apiUrl = `http://localhost:3000/scraper?${chunk.map(id => `idarirbnb=${id}`).join('&')}&checkin=${checkin}&checkout=${checkout}`;

        console.log(`📡 Enviando consulta ${i} a la API: ${apiUrl}`);

        try {
            const response = await axios.get(apiUrl);
            console.log(`✅ Respuesta de la API para IDs ${chunk.join(', ')}:`, response.data);

            // 🔹 Convertir los datos de la API a formato CSV
            if (response.data.length > 0) {
                const csv = parse(response.data, { fields: Object.keys(response.data[0]), header: firstBatch });
                writeStream.write(csv + '\n');
                firstBatch = false; // 🔹 Asegurar que solo la primera vez escribimos el encabezado
            }

        } catch (error) {
            console.error(`❌ Error en la API con IDs ${chunk.join(', ')}:`, error.response?.data || error.message);
        }

        await new Promise(resolve => setTimeout(resolve, 2000)); // 🔹 Reducimos la espera a 2 segundos
    }

    writeStream.end(); // 🔹 Cerrar el archivo al terminar

    console.log(`📁 Datos guardados correctamente en ${fileName}`);
    await browser.close();
})();
