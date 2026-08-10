FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/data/models/huggingface \
    ULTRALYTICS_CONFIG_DIR=/data/models/ultralytics

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY core.py service.py benchmark_models.py ./
RUN python -c "from ultralytics import YOLO; YOLO('yolo11n.pt'); YOLO('yolo26n.pt')"

EXPOSE 8098
CMD ["uvicorn", "service:app", "--host", "127.0.0.1", "--port", "8098"]
