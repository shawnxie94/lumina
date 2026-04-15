# Infographic Adaptive Height Display Design

## 背景

Lumina 文章详情页已经支持展示 AI 生成的信息图，当前入口主要有两类：

- 文章详情页 AI 面板中的信息图 tab
- 信息图放大预览 lightbox

相关实现集中在：

- [frontend/components/article/ArticleInfographic.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/article/ArticleInfographic.tsx)
- [frontend/pages/article/[id].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/article/[id].tsx)

目前的信息图展示有一个固定假设：预览卡片、lightbox 以及导出画布都按 `1080x1440` 的 `3:4` 竖版比例处理。

这个假设对标准单页信息图是成立的，但对“HTML 内容仍然完整、只是实际高度超过 3:4”的信息图会造成直接裁切。当前线上文章
[https://lumina.shawnxie.top/article/ai-first-is-not-the-same-as-using-ai-7484bf46](https://lumina.shawnxie.top/article/ai-first-is-not-the-same-as-using-ai-7484bf46)
就是一个典型例子：信息图 HTML 仍然存在完整内容，但前端展示容器仍然按固定 `3:4` 视口绘制，导致底部内容显示不全。

用户这次明确要求的方向不是自动修复信息图生成逻辑，也不是改成滚动查看，而是：

- 前端容器边框高度可以自动拉长
- 让 HTML 版信息图尽量完整展示
- 先不改后端自动修复或再生成流程

## 目标

- 对基于 `infographic_html` 渲染的信息图，按真实内容比例自动拉长展示容器高度。
- 保持信息图卡片宽度稳定，不因超长内容改成横向压缩布局。
- 文章详情页中的信息图 tab 优先完整展示 HTML 信息图内容，不再固定裁成 `3:4`。
- lightbox 预览不再写死 `3:4`，而是优先根据真实内容比例展示，避免再次裁切。
- 正常 `3:4` 信息图在视觉上保持与现在基本一致。

## 非目标

- 不修改后端信息图生成 prompt、清洗或自动修复逻辑。
- 不改动信息图导出为图片时的固定画布尺寸与导出格式。
- 不尝试从已裁切的 `infographic_image_url` 图片中恢复缺失内容。
- 不把超长信息图改造成容器内滚动查看。
- 不在本期支持多页信息图拼接、分页或长图重新切片。

## 当前约束

### 一、信息图展示与导出职责混在同一组件

[frontend/components/article/ArticleInfographic.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/article/ArticleInfographic.tsx)
中的 `InfographicCanvas` 同时承担：

- 预览测量
- lightbox 展示
- 离屏导出画布

这意味着本次要区分“展示容器尺寸可以变”和“导出画布仍需固定”这两类职责，避免展示改动误伤导出链路。

### 二、当前展示层写死了 `3:4`

当前以下位置都直接把信息图视作 `3:4`：

- `InfographicPreviewCard` 使用 `aspect-[3/4]`
- `InfographicLightbox` 外层容器使用 `aspect-[3/4]`
- `renderInfographicNodeToBlob` 仍按 `1080x1440` 导出

其中前两者属于展示约束，可以调整；最后一个属于导出契约，本次不改。

### 三、图片 fallback 无法补回已丢失内容

当文章只有 `infographic_image_url`，或者图片本身在生成阶段已经被裁掉时，前端只能显示已有图片像素内容，无法恢复丢失区域。

因此本次“完整展示”只对 `infographic_html` 路径有效，对纯图片 fallback 仅保持现状。

### 四、lightbox 受视口高度天然限制

页面内联卡片可以随着页面自然增高；但 lightbox 运行在视口内，特别长的内容无法在任何设备上同时满足：

- 绝不缩小
- 不滚动
- 始终完整可见

所以本次优先级定义为：

1. 页面内联展示完整优先
2. lightbox 避免裁切优先
3. 当视口无法容纳真实高度时，允许 lightbox 在不裁切的前提下缩放适配视口

## 方案比较

### 方案 A：仅把外层 `aspect-[3/4]` 去掉，完全依赖内容自然撑高

优点：

- 实现看起来最简单
- 语义上接近“边框跟着内容走”

缺点：

- 当前 `InfographicCanvas` 内部仍是“固定视口 + transform 缩放”结构，单纯去掉外层比例并不能正确让内部跟随真实尺寸
- preview、lightbox、export 共用同一画布逻辑，直接放开容易引入错位或空白

### 方案 B：保留现有测量逻辑，但把测得的真实宽高暴露给外层，由外层动态设置展示比例

优点：

- 改动集中，复用现有 `intrinsicSize` 计算
- 能同时覆盖文章页预览与 lightbox
- 对导出逻辑影响最小

缺点：

- 需要为 `InfographicCanvas` 新增尺寸回调
- 需要让 preview / lightbox 分别处理默认比例与动态比例切换

### 方案 C：展示路径与导出路径彻底拆成两套组件

优点：

- 职责最清晰
- 长期演进空间更好

缺点：

- 对这次需求来说明显过重
- 容易把一个展示修复扩成组件重构

## 结论

采用 **方案 B：保留当前测量逻辑，将真实内容尺寸回传给外层容器，由外层动态拉长展示比例**。

原因：

- 最符合本次“只修展示、不动生成”的范围要求。
- 改动集中在现有信息图组件内，风险可控。
- 能覆盖文章页 tab 和 lightbox 两个主要展示场景。
- 可以保持导出链路完全不变，避免把线上图片导出能力卷入这次修复。

## 详细设计

### 一、核心思路

`InfographicCanvas` 现有逻辑已经会在挂载后测量内容的：

- `rootWidth / rootHeight`
- `scrollWidth / scrollHeight`
- 最终的 `measuredWidth / measuredHeight`

这些值目前只用于内部计算缩放与偏移，但没有向外暴露。

本次改为：

1. `InfographicCanvas` 继续负责测量真实内容尺寸。
2. 测得的 `measuredWidth / measuredHeight` 通过回调或状态同步给外层。
3. 外层预览容器根据 `width / height` 计算真实展示比例。
4. 当比例高于 `3:4` 时，容器随之拉高。
5. 当比例仍接近 `3:4` 时，外观与当前保持一致。

这样既保留了现有 transform 缩放方案，也让外层边框能够跟着内容高度变化。

### 二、`InfographicCanvas` 职责调整

`InfographicCanvas` 新增一个可选的尺寸变更回调，例如：

- `onMeasure?: (size: { width: number; height: number }) => void`

行为要求：

- 每次测量出新的 `intrinsicSize` 后，向外同步一次尺寸。
- 只有当尺寸真的变化时才触发，避免无意义重复 setState。
- 默认无回调时维持现有行为，不影响导出画布。

这使得组件继续是“单一信息图画布”，但同时对外暴露真实比例信息。

### 三、文章页预览卡片

`InfographicPreviewCard` 当前把外层写死为 `aspect-[3/4]`。本次改为：

- 默认比例仍为 `3 / 4`
- 一旦拿到 `InfographicCanvas` 测得的真实尺寸，就按 `width / height` 动态设置外层 `aspect-ratio`

展示规则：

- 宽度保持 `w-full`
- 高度由比例自动计算
- 不引入滚动条
- 保持现有圆角、背景与 hover 样式

结果是：

- 标准信息图仍近似原样
- 超长信息图会在文章详情页内联区域自然变成长卡片

### 四、lightbox 展示

`InfographicLightbox` 不再使用固定 `aspect-[3/4]`。

新规则：

- 外层容器宽度继续受 viewport 限制
- 高度根据真实比例自动计算
- 当真实高度未超过可用视口时，按内容比例完整拉长显示
- 当真实高度超过可用视口时，以“完整可见、不裁切”为优先，允许整体等比缩放到视口内

这意味着：

- 对中度超长信息图，lightbox 会显著比现在更高
- 对极长信息图，lightbox 仍能避免裁切，但不承诺维持原字号

这个折中是由视口物理限制决定的，不属于体验退让。

### 五、导出画布保持不变

`InfographicExportCanvas` 与 `renderInfographicNodeToBlob` 本次不改。

原因：

- 用户这次只要求修展示
- 导出链路仍服务于复制为图片 / 上传图片
- 当前线上图片成品是否裁切属于生成和导出阶段问题，不应在这次展示修复里混改

这部分继续保持：

- `1080x1440`
- 固定离屏导出画布
- 复制图片能力不变

### 六、fallback 图片路径

对于仅有 `infographic_image_url` 的情况：

- 继续使用现有 `<img>` 展示
- 不做额外高度计算

原因：

- 图片本身已有固定像素尺寸
- 如果图片内容已经缺失，拉高外框也无意义

因此本次“完整展示”的提升只作用于 `infographic_html` 可用的文章。

## 数据流与状态设计

### 一、尺寸状态位置

尺寸状态应保留在消费方组件中，而不是上抛到文章详情页页面级。

推荐方式：

- `InfographicPreviewCard` 自己持有 measured ratio state
- `InfographicLightbox` 自己持有 measured ratio state

原因：

- 这是纯展示态，不需要跨组件共享
- 避免把页面级状态继续堆进 [frontend/pages/article/[id].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/article/[id].tsx)

### 二、默认值策略

首屏渲染前没有测量值时：

- 预览卡片先按 `3:4` 渲染
- 测量完成后平滑切到真实比例

这样可以避免：

- 首屏完全塌陷
- SSR / hydration 阶段高度不确定导致的异常闪烁

## 错误处理与边界行为

### 一、测量失败

如果因为浏览器环境或内容结构导致测量失败：

- 回退到默认 `3:4`
- 不阻断展示
- 不影响复制图片和导出路径

### 二、异常极长 HTML

如果 HTML 的真实高度远超普通长图范围：

- 页面内联区域允许自然变高
- lightbox 以完整可见优先进行等比缩放

本期不对异常长图额外设置截断或上限。

### 三、内容后续异步变化

如果字体加载完成后真实高度发生变化：

- 依赖现有 `ResizeObserver` 重新测量
- 外层比例应随新的测量结果更新

## 测试与验证策略

### 一、手动验证

重点检查以下场景：

1. 标准 `3:4` 信息图：样式无明显回归
2. 超长 HTML 信息图：文章详情页内联区域完整显示
3. 超长 HTML 信息图：lightbox 不再裁切底部
4. 纯 `infographic_image_url` fallback：行为保持不变
5. 复制为图片：功能仍可正常执行

### 二、建议补充的前端单测

如果当前组件测试基建允许，优先为“比例回退与动态更新”补最小单测：

- 无测量值时使用默认 `3:4`
- 测量值为超长比例时，外层样式更新为更高比例

若当前仓库没有适合的组件测试基建，则本次以手动验证为主，不强行引入新测试体系。

## 影响范围

主要改动文件：

- [frontend/components/article/ArticleInfographic.tsx](/Users/shawn/Documents/GitHub/lumina/frontend/components/article/ArticleInfographic.tsx)

联动验证文件：

- [frontend/pages/article/[id].tsx](/Users/shawn/Documents/GitHub/lumina/frontend/pages/article/[id].tsx)

本次不预期修改：

- 后端信息图生成与修复逻辑
- `infographic_image_url` 存储路径
- 信息图导出图片尺寸契约

## 风险

### 一、首屏比例切换带来的轻微布局跳动

由于真实尺寸只能在客户端测量，首屏可能先按 `3:4` 渲染，再在测量后拉长。

这是可接受的，但实现时应尽量保持：

- 默认高度接近现状
- 比例变化不引入明显闪动

### 二、lightbox 在极端长图上的视觉预期

即使不裁切，极长图在视口内也可能显得更小。这不是实现缺陷，而是“不滚动、不裁切、受视口限制”三者共同决定的物理上限。

### 三、导出与展示比例分离后的心智差异

用户可能在页面上看到“完整长图 HTML”，但复制出来的图片仍是固定 `1080x1440` 成品。

这属于本期明确接受的范围切分；后续若要彻底一致，需要单独讨论生成与导出策略。
