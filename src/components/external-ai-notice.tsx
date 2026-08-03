export function ExternalAiNotice() {
  return (
    <aside className="notice" aria-label="外部 AI 数据说明">
      <strong>继续后，与当前任务有关的经历、JD 或投递记录会先经过应用服务端，再由第三方 AI 瞬时处理以生成建议。</strong>
      <p>只发送完成当前任务所需的字段；应用服务端不持久化原文，生成内容仍需你确认后才会保存。</p>
      <p>请先删除姓名、手机号、证件号等不必要的敏感信息。</p>
    </aside>
  );
}
