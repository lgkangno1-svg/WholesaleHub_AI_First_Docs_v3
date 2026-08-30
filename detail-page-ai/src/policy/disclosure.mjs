export const IMAGE_TEXT_RISK_VERSION = 'image-text-risk-v1';

export const IMAGE_TEXT_RISK_NOTICE =
  'AI 이미지 생성 특성상 이미지 안의 한글·숫자·기호에 오타, 글자 깨짐, 누락 또는 잘못된 표기가 발생할 수 있습니다. 이미지에 합성된 글자는 일반 문서의 텍스트처럼 부분 수정이 어려워 수정이 필요한 경우 해당 이미지 또는 영역을 다시 생성해야 할 수 있으며, 재생성 후에도 동일한 구성이나 완벽한 오타 교정을 보장할 수 없습니다. 서비스는 자동 검수와 재생성을 통해 오류를 줄이지만 모든 이미지 내 텍스트의 100% 정확성을 보장하지 않습니다.';

export function assertDisclosureAccepted(orderInput) {
  if (orderInput?.imageTextRiskAccepted !== true) {
    throw new Error('IMAGE_TEXT_RISK_ACK_REQUIRED');
  }
  return IMAGE_TEXT_RISK_VERSION;
}
