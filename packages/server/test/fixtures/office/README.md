# Word 与 Excel 样本（39 §14）

真实软件保存的文件，用来覆盖各家写法的差异；测试里需要的其他文件（zip 炸弹、损坏的文件、单元格超限的工作簿、程序写的没有公式缓存结果的工作簿）在测试中现场生成。

| 文件 | 来源 |
| --- | --- |
| `report.libreoffice.docx` | 一份含标题、粗体与斜体、链接、无序与有序列表、表格、内嵌图片（替代文字「导出按钮位置」）的 HTML，用 LibreOffice 26 `soffice --headless --convert-to docx` 转换 |
| `report.textutil.docx` | 同一份 HTML，用 macOS 的 `textutil -convert docx` 转换（文本编辑的写法：没有标题样式，表格成了段落，图片丢失） |
| `report.doc` | 同一份 HTML，用 LibreOffice 存为 Word 97 |
| `report.encrypted.docx` | `report.libreoffice.docx` 用 `msoffcrypto-tool -e -p secret` 加上打开密码（与 Office 一样的 OLE 包装） |
| `sales.libreoffice.xlsx` | exceljs 写出「明细」（日期、数量、单价、公式金额，第 4 行隐藏）、「汇总」（A1:B1 合并，SUMIF 与 SUM 公式，含竖线的富文本）、隐藏的工作表「隐藏」，再用 LibreOffice 另存为 xlsx（公式带上缓存结果） |
| `sales.xls` | 同上，用 LibreOffice 存为 Excel 97 |

Microsoft Word 与 WPS 保存的样本待补：脚本驱动 Word 另存失败，WPS 只能手动操作。
