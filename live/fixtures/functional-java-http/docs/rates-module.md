# 运费模块运行说明

运费查询服务位于 `services/rates`，只使用 JDK 的 HTTP 服务。测试入口源文件为 `services/rates/example/rates/CatalogProbe.java`，其中的主类是 `example.rates.CatalogProbe`。用 JDK 单文件方式启动，无需安装库或执行构建。服务只监听本机，读取环境变量 `PORT` 分配端口。仓库保存了 IDEA 的「Rates API local」运行配置。用该配置核对主类，「Offline utility」只供离线工具使用。

就绪路径为 `GET /system/ping`，成功应返回 HTTP 204。测试接口为 `GET /v1/rate`，默认试算应返回 HTTP 200 和 JSON `{"rate":23,"currency":"CNY"}`。用例只需读取，不需要账号或写入。
