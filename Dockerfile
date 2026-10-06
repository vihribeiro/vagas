FROM python:3.12-slim

# app roda sem root: o banco fica no volume montado em /data, e o diretório
# é criado pertencente ao usuário app para o compose usar a mesma ownership.
RUN groupadd -r app && useradd -r -g app -m -d /srv app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN mkdir -p /data && chown -R app:app /srv /data

ENV VAGAS_DATA_DIR=/data
EXPOSE 8000

USER app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]