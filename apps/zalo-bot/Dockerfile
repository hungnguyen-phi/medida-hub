# Zalo → Facebook + Google Business autopost — image cho Coolify / VPS
FROM node:20-bookworm-slim

# ffmpeg+ffprobe: xử lý/trích khung video. ca-certificates: gọi Graph API qua HTTPS.
# xvfb+x11vnc+novnc+websockify: cho phép đăng nhập Google Business TƯƠNG TÁC qua noVNC
# (trình duyệt chạy trên màn hình ảo của VPS, nhúng vào dashboard để người dùng tự đăng nhập).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates xvfb x11vnc novnc websockify \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cài deps trước (tận dụng cache; sharp tải binary ở bước này)
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Playwright: tải Chromium + thư viện hệ thống (libnss3, fonts...) để đăng Google Business.
# Bắt buộc — thiếu bước này postToGBP() sẽ chết trong container.
RUN npx playwright install --with-deps chromium

# Mã nguồn (data/, output/, .env, creds... bị loại bởi .dockerignore)
COPY . .

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    ROUTES_FILE=/app/data/routes.json \
    WEB_PORT=8088

# Mọi dữ liệu ghi-runtime nằm dưới /app/data -> mount volume bền vào đây trên Coolify
VOLUME ["/app/data"]
EXPOSE 8088

CMD ["node", "src/service.mjs"]
