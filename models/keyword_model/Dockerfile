FROM python:3.11-slim

WORKDIR /service

COPY models/keyword_model/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY models/keyword_model/ /service/

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
