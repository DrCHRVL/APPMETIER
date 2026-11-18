"""
Construction de l'image : télécharge les modèles UNE fois et les éprouve sur
une page de test. Au lancement, le conteneur n'a plus accès à Internet.
"""
import io

from PIL import Image, ImageDraw, ImageFont

import moteur

img = Image.new('RGB', (1400, 260), 'white')
police = ImageFont.load_default(size=64)
ImageDraw.Draw(img).text((60, 90), 'Procès-verbal de test', fill='black', font=police)
tampon = io.BytesIO()
img.save(tampon, 'PNG')
page = moteur.lire(tampon.getvalue())[0]
print('[ocr] modèles prêts —', repr(page.texte), page.confiance)
assert 'verbal' in page.texte, 'les modèles ne lisent pas la page de test'
