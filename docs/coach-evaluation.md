# AI 教学质量评测

当前软件已经有结构校验，能拦截缺材料、题型不匹配、选项答案矛盾和重复题。新增的评测层用于检查更接近教学质量的可观察要求，暂时不调用真实模型：

- 阅读题必须有完整文章，听力题必须有音频材料。
- 模式、题型和能力标签必须一致。
- 题干必须包含场景要求的关键信息。
- 表达建议必须保留用户原句中的关键细节，不能直接复制参考答案。
- 批改正确性必须和评测样例一致。

运行测试：

```powershell
npm test
```

如果以后要评估真实模型，可以准备一个 JSON 文件：

```json
{
  "tasks": [{
    "case": "reading-main-idea",
    "output": {
      "kind": "choice",
      "skill": "阅读",
      "level": "A2",
      "reason": "练习主旨理解",
      "prompt": "What is the main idea?",
      "passage": "Mia studies every morning.",
      "audio": "",
      "options": ["She studies.", "She sleeps."],
      "answer": "She studies.",
      "hint": "先看全文。"
    }
  }],
  "feedback": []
}
```

然后运行：

```powershell
npm run evaluate:coach -- .\fixture.json
```

这套规则是质量门槛，不是英语教学效果的最终证明。真正的下一步仍然需要一组人工标注的真实模型输出，比较题目相关性、难度连续性、批改准确度和表达建议是否保留原意。
