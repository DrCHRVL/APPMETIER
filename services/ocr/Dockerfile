# SIRAL — service OCR (PaddleOCR PP-OCRv5). Voir docs/OCR.md.
#
# Sans clé, sans données, sans Internet : les modèles sont téléchargés et
# éprouvés À LA CONSTRUCTION, puis l'image ne fait plus que lire des pages.
FROM python:3.12-slim

# libgomp : calcul parallèle de Paddle ; libgl/libglib : OpenCV tiré par paddlex
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY moteur.py app.py prechargement.py ./

# Téléchargement + validation des modèles, puis rangement en lecture seule.
ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    PADDLE_PDX_CACHE_HOME=/tmp/paddlex-build
RUN python prechargement.py \
  && mkdir -p /opt/modeles \
  && mv /tmp/paddlex-build/official_models/* /opt/modeles/ \
  && rm -rf /tmp/paddlex-build \
  && SIRAL_OCR_MODELES=/opt/modeles PADDLE_PDX_CACHE_HOME=/tmp/verif python prechargement.py \
  && rm -rf /tmp/verif

# À l'exécution : modèles embarqués ; cache de travail paddlex dans /tmp (tmpfs).
ENV SIRAL_OCR_MODELES=/opt/modeles \
    PADDLE_PDX_CACHE_HOME=/tmp/paddlex \
    HOME=/tmp \
    PYTHONUNBUFFERED=1

USER nobody
EXPOSE 8788
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8788", "--workers", "1", "--no-server-header"]
