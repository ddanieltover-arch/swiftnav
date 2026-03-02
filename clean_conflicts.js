const fs = require('fs');
const path = require('path');

const files = [
    'about.html', 'air-freight.html', 'careers.html', 'index.html',
    'ground-delivery.html', 'ocean-freight.html', 'performance.js',
    'services.html', 'style.css', 'warehousing.html'
];

files.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        if (content.startsWith('<<<<<<< HEAD')) {
            const lines = content.split('\n');
            const separatorIndex = lines.findIndex(l => l.trim() === '=======');
            if (separatorIndex !== -1) {
                // Keep lines from 1 to separatorIndex (0-indexed lines[1] to lines[separatorIndex-1])
                const headLines = lines.slice(1, separatorIndex);
                fs.writeFileSync(filePath, headLines.join('\n'), 'utf8');
                console.log(`✅ Cleaned ${file}`);
            }
        }
    }
});
