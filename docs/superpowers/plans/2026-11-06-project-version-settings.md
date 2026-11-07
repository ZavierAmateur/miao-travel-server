# 项目设置与版本控制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在管理后台“项目设置 → 版本控制”页面读取、校验并保存客户端兼容规则。
**Architecture:** 沿用 bootstrap 配置文档，新增管理员 GET/PUT 接口、Cookie鉴权、config:read/config:publish权限、乐观并发更新和审计；Vue页面遵循现有Element Plus布局。只修改最新/最低版本，维护与云档开关保留。
**Tech Stack:** Fastify、TypeScript、CloudBase、Vue3、Element Plus、Vitest。
**Spec:** 用户已指定入口“项目设置”及区域“版本控制”，复用已确认的统一兼容规则与冷启动客户端；本计划记录具体实现选择。

## Global Constraints
- 保存立即影响后续冷启动，必须校验三段数字版本和最低不高于最新；原生客户端版本仍在client-version.json填写。
- 运营可查看，保存生效需已有config:publish权限；自动递增revision和记录操作者。
- 冲突返回409，保留表单，不静默覆盖其他人或维护开关；页面显示加载/失败/只读状态。
- 不部署服务、不修改线上规则，不覆盖既存存档与关卡工作区改动。

## Review Focus
- 未登录、无发布权限、非法输入和跨站来源均不能写入。
- 两个管理员并发及首次初始化只能一个写入成功。
- 保存不能重置维护和云档开关，公共启动接口立即读到新规则。
- 页面读取失败不能用空表单覆盖线上规则；保存失败保留输入，可明确重新加载。
- 提高最低版本确认对旧玩家影响，取消确认不保存；文档改为后台填写步骤。

### Task 1: 管理端接口与配置并发写入
- [x] 写API与仓储测试，验证缺失功能失败。
- [x] 新增项目设置服务、GET/PUT路由、审计和CAS，CLI发布也使用CAS。
- [x] 运行服务端测试、类型和lint。
### Task 2: 后台项目设置页
- [x] 写API客户端及页面行为测试，验证失败。
- [x] 新增菜单、路由、版本表单、确认和权限状态；验证测试和构建。
### Task 3: 交付
- [x] 本地内存后端与后台页面可视验证，不连接线上写入。
- [x] 更新用户使用说明与API说明，独立复核后记录结果。

## 交付验证

- 后台前端全量19/19；生产构建（含vue-tsc）和lint通过。
- 服务端全量177/177；typecheck和lint通过。
- 新增接口与仓储测试8项；独立复核运行当时7项全部通过，静态复核无可操作缺陷。后续补验审计故障说明，第8项通过。
- 真实浏览器本地验证：菜单入口、字段读取、提高最低版本确认、保存成功、重新加载保留值。仅连接本地内存API，未写线上。
- 截图：/Users/sj/Documents/社交机器人/outputs/版本控制器后台_20261106/项目设置.jpg。
- 使用说明首屏步骤已改为“项目设置 → 版本控制”，CLI/数据库解释留在详细部分。
- 临时浏览器页与本地预览服务已关闭。未部署服务端、未上线后台、未修改线上门槛；保留现有用户工作区改动。
