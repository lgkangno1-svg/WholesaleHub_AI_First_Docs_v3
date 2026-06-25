# 18. Deployment

## Mini PC Docker 구성

```txt
docker-compose.yml
  n8n
  wholesalehub-api
  sqlite volume
  playwright-runner
```

## 환경변수

```env
DATABASE_URL=/data/wholesalehub.sqlite
GEMINI_API_KEY=
WOOCOMMERCE_BASE_URL=https://hub.avocadoss.co.kr
WOOCOMMERCE_CONSUMER_KEY=
WOOCOMMERCE_CONSUMER_SECRET=
TZ=Asia/Seoul
```

## 백업

- SQLite DB는 매일 1회 백업
- product_mapping은 가장 중요한 자산이므로 별도 백업
- n8n workflows export 보관
