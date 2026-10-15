export const researchLoopEn = {
  title: 'Research feedback', availability: '{{count}}/3 available', included: 'Reviewed in synthesis', pending: 'Awaiting synthesis update',
  loading: 'Reading research feedback…', readError: 'Research feedback is unavailable; current status could not be checked.', runError: 'The research update was not confirmed. Retry reading its status.',
  details: 'Research feedback details', retry: 'Retry status', run: 'Update research', running: 'Updating…',
  scope: 'Research is supporting context, not three independent votes. Predictive value remains unverified.',
  demo: 'Illustrative research feedback · no real task or model call.', updated: 'Updated {{time}}', noTime: 'No result recorded',
  invalid: '{{count}} unverifiable records excluded.', review: 'Research reviewed · {{effect}}',
  effects: { 'context-only': 'context only', caution: 'caution retained', conflict: 'conflict retained' },
  sources: { prediction: 'Auto Prediction', jev: 'Jev', quant: 'Auto Quant' },
  states: { ready: 'Available', waiting: 'Waiting', running: 'Research running', failed: 'Failed', blocked: 'Blocked', stale: 'Outdated · excluded' },
}
export const researchLoopZh: typeof researchLoopEn = {
  title: '研究反馈', availability: '{{count}}/3 已回流', included: '已纳入综合研判', pending: '待综合更新',
  loading: '正在读取研究反馈…', readError: '暂时无法核对研究反馈的当前状态。', runError: '尚未确认研究更新是否完成，请重新读取状态。',
  details: '查看研究反馈', retry: '重试读取', run: '更新研究', running: '正在更新…',
  scope: '研究结果作为判断参考，不按三票表决；预测效果仍待验证。',
  demo: '研究反馈演示 · 未运行真实任务或调用模型。', updated: '更新于 {{time}}', noTime: '尚无结果记录',
  invalid: '{{count}} 条未通过核验的记录已排除。', review: '研究已审阅 · {{effect}}',
  effects: { 'context-only': '仅作背景参考', caution: '保留谨慎条件', conflict: '保留证据分歧' },
  sources: { prediction: 'Auto Prediction', jev: 'Jev', quant: 'Auto Quant' },
  states: { ready: '已回流', waiting: '等待研究', running: '研究中', failed: '研究失败', blocked: '暂受阻', stale: '已过期 · 不采用' },
}
