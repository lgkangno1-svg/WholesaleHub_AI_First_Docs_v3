# Qwen 2.5B Evaluation

## 목적

Gemini Flash 비용을 줄이기 위해 로컬 Qwen 2.5B가 상품명 파싱에 충분한지 평가한다.

## 기본 정책

- MVP 실전 기본값은 Gemini Flash
- Qwen은 offline evaluation only
- 정확도 90% 이상일 때 제한 카테고리부터 적용 검토

## 평가 기준

- normalized_name 정확도
- 수량/중량 추출 정확도
- 등급 추출 정확도
- 원산지 추출 정확도
- option_key 일관성
- JSON 유효성
