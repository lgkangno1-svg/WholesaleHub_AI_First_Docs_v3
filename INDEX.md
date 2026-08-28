# 문서 색인

## 최상위 기준
- `PROJECT_NORTH_STAR.md` — 개발 목적, 제품 기획, 개선 우선순위, 안전/배포/완료 기준의 canonical source
- `AGENTS.md` — 모든 AI/개발자의 공통 실행 규칙
- `AI_HANDOFF.md` — 현재 운영 상태, 최근 변경, 다음 작업

## 공통
- README.md
- CODEX.md
- ANTIGRAVITY.md
- OPERATIONS.md

## PRD
- PRD/00_Project_Overview.md
- PRD/01_v3_Decisions.md
- PRD/02_System_Architecture.md
- PRD/03_Risk_and_Compliance.md
- PRD/04_Tech_Stack.md
- PRD/05_Supplier_Data_Collection.md
- PRD/06_DailyFood_GoogleSheet.md
- PRD/07_AdminPlus_Limited_Crawling.md
- PRD/08_Product_Normalization.md
- PRD/09_Database_Design.md
- PRD/10_Price_Engine.md
- PRD/11_WooCommerce_Integration.md
- PRD/12_Admin_Dashboard.md
- PRD/13_n8n_Workflows.md
- PRD/14_Playwright_Framework.md
- PRD/15_API_Specification.md
- PRD/16_Exception_Handling.md
- PRD/17_Testing.md
- PRD/18_Deployment.md
- PRD/19_Roadmap.md

## Prompts
- Prompts/Gemini_Product_Parsing.md
- Prompts/Qwen_Evaluation.md
- Prompts/Codex_Implementation.md
- Prompts/Antigravity_Implementation.md

## Tasks
- Tasks/Phase_1_MVP.md
- Tasks/Phase_2_Admin.md
- Tasks/Phase_3_WooCommerce.md
- Tasks/Phase_4_Future_Auto_Order.md

## Config
- config/suppliers.example.yml
- config/suppliers/dailyfood.google_sheet.yml
- config/suppliers/adminplus.limited_crawl.example.yml
- config/suppliers/excel_link_supplier.example.yml

## SQL
- sql/schema.sql
- sql/seed_suppliers.sql

## 유지 규칙
- 모든 기능 작업 전 `PROJECT_NORTH_STAR.md` → `AGENTS.md` → `AI_HANDOFF.md` 순서로 확인합니다.
- 현재 구현 상태는 `AI_HANDOFF.md`에 계속 갱신합니다.
- 제품 목표/정책/개선 기준 자체가 바뀌면 같은 PR에서 `PROJECT_NORTH_STAR.md`를 갱신합니다.
