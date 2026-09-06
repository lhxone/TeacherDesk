<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import NavIcons from "@/components/icons/NavIcons.vue";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const startRoute = computed(() => (auth.isAuthenticated ? "/" : "/register"));
const activePreview = ref(0);
const previews = ["从容安排每一天", "让课堂人人参与", "看见每一次进步"];
const features = [
  {
    icon: "classes" as const,
    number: "01",
    title: "班级里的每一位，都心中有数",
    text: "从班级名单到学生档案，批量导入、标签管理与学年归档，让琐碎的信息井井有条。",
    tags: ["学生档案", "批量导入", "班级归档"],
  },
  {
    icon: "schedule" as const,
    number: "02",
    title: "课表与待办，安排在一起",
    text: "周课表支持单双周，日视图串起课程与待办。开启推送提醒，给下一件事留一点准备时间。",
    tags: ["单双周课表", "关联班级", "推送提醒"],
  },
  {
    icon: "tools" as const,
    number: "03",
    title: "把课堂交给更多可能",
    text: "不重复抽签、按成绩或性别均衡分组；拖拽调整座位，保留固定位置，也照顾需要坐在前排的学生。",
    tags: ["随机抽签", "均衡分组", "多套座位方案"],
  },
  {
    icon: "home" as const,
    number: "04",
    title: "从一张成绩单，看见成长",
    text: "快捷录入与缺考标记，让统计更清楚。结合班级分布、考试趋势与学生雷达图，理解每一次变化。",
    tags: ["成绩录入", "班级与个人分析", "CSV 导出"],
  },
];
const faqs = [
  {
    question: "如何开始使用教师工作台？",
    answer:
      "向已注册的老师索取邀请码，完成注册后即可创建班级、导入学生，并设置自己的课表。已有账号可以直接登录。",
  },
  {
    question: "电脑和手机都可以使用吗？",
    answer:
      "可以在电脑和手机浏览器中使用，也支持以 PWA 形式添加到主屏幕。座位图的编辑在电脑端完成，手机端可以查看。",
  },
  {
    question: "没有网络时还能查看吗？",
    answer:
      "离线时可以只读查看已缓存的班级、学生、今日日程与当前座位图。首次使用需要联网；修改和保存需要恢复网络，成绩分析不做离线缓存。",
  },
  {
    question: "什么时候能收到课程和待办提醒？",
    answer:
      "在支持 Web Push 的浏览器中授权通知并开启提醒后，可以配置提前提醒的分钟数。通知的送达也受系统设置和网络状态影响；iOS 需要将应用添加到主屏幕，并使用支持推送的系统版本。",
  },
];
let previousTitle = "";
const page = ref<HTMLElement | null>(null);
const motionReady = ref(false);
let revealObserver: IntersectionObserver | undefined;
let resizeObserver: ResizeObserver | undefined;
let motionPreference: MediaQueryList | undefined;
let scrollFrame = 0;

function updateProgress() {
  scrollFrame = 0;
  const distance = document.documentElement.scrollHeight - window.innerHeight;
  page.value?.style.setProperty(
    "--reading-progress",
    String(
      distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0,
    ),
  );
}

function queueProgress() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateProgress);
}

function configureMotion() {
  revealObserver?.disconnect();
  motionReady.value =
    !motionPreference?.matches && "IntersectionObserver" in window;
  if (!motionReady.value) return;
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          revealObserver?.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );
  page.value
    ?.querySelectorAll(
      ".section-heading, .feature-card, .knowledge-copy, .library-demo, .everywhere, .benefits article, .faq-section, .closing",
    )
    .forEach((element) => {
      element.classList.add("scroll-reveal");
      revealObserver?.observe(element);
    });
}

onMounted(() => {
  previousTitle = document.title;
  document.title = "教师工作台 TeacherDesk · 把时间留给教学";
  motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionPreference.addEventListener("change", configureMotion);
  configureMotion();
  window.addEventListener("scroll", queueProgress, { passive: true });
  window.addEventListener("resize", queueProgress);
  if ("ResizeObserver" in window && page.value) {
    resizeObserver = new ResizeObserver(queueProgress);
    resizeObserver.observe(page.value);
  }
  queueProgress();
});
onUnmounted(() => {
  document.title = previousTitle;
  revealObserver?.disconnect();
  resizeObserver?.disconnect();
  motionPreference?.removeEventListener("change", configureMotion);
  window.removeEventListener("scroll", queueProgress);
  window.removeEventListener("resize", queueProgress);
  cancelAnimationFrame(scrollFrame);
});
</script>

<template>
  <div ref="page" class="about-page" :class="{ 'motion-ready': motionReady }">
    <div class="reading-progress" aria-hidden="true"></div>
    <a class="skip-link" href="#intro">跳转到产品介绍</a>
    <header class="about-header wrap">
      <RouterLink to="/about" class="wordmark" aria-label="教师工作台介绍页">
        <span class="logo"><NavIcons name="logo" /></span>
        <span>教师工作台<small>TeacherDesk</small></span>
      </RouterLink>
      <nav aria-label="产品导航" class="header-links">
        <a href="#features">产品功能</a><a href="#knowledge">知识中心</a
        ><a href="#questions">常见问题</a>
      </nav>
      <RouterLink :to="auth.isAuthenticated ? '/' : '/login'" class="login-link"
        >{{ auth.isAuthenticated ? "进入工作台" : "登录工作台" }}
        <span aria-hidden="true">↗</span></RouterLink
      >
    </header>

    <section id="intro" class="hero wrap">
      <div class="hero-copy">
        <p class="eyebrow">
          <span class="status-dot"></span> 为每一位认真教学的老师而设计
        </p>
        <h1>
          让日常更有序，<br />把时间<span class="underlined">留给教学。</span>
        </h1>
        <p class="hero-description">
          班级、课表、课堂互动与成绩分析，一个工作台就够了。<br
            class="desktop-break"
          />少一点事务之间的切换，多一点与学生相处的时间。
        </p>
        <div class="hero-actions">
          <RouterLink :to="startRoute" class="action primary"
            >{{ auth.isAuthenticated ? "打开我的工作台" : "开启我的工作台" }}
            <span aria-hidden="true">↗</span></RouterLink
          >
          <a href="#preview" class="action secondary"
            >探索产品 <span aria-hidden="true">↓</span></a
          >
        </div>
        <p class="hero-note">
          面向中小学教师 <span>·</span> 电脑与手机均可使用
          <span>·</span> 注册需邀请码
        </p>
      </div>
      <div class="margin-note" aria-hidden="true">
        <span>备课有条理</span><span>上课有底气</span
        ><svg viewBox="0 0 100 60">
          <path d="M80 5Q95 55 12 43M12 43l17-10M12 43l18 10" />
        </svg>
      </div>

      <div id="preview" class="product-preview">
        <div class="preview-top">
          <span class="window-dots" aria-hidden="true"
            ><i></i><i></i><i></i></span
          ><span>TeacherDesk / 你的教学日常</span
          ><span class="demo-label">功能示意 · 示例数据</span>
        </div>
        <div class="preview-body">
          <aside class="preview-sidebar" aria-hidden="true">
            <span class="mini-brand"><NavIcons name="logo" /> 教师工作台</span>
            <span :class="{ selected: activePreview === 0 }"
              ><NavIcons name="home" /> 我的首页</span
            >
            <span><NavIcons name="classes" /> 班级管理</span>
            <span><NavIcons name="schedule" /> 教学日程</span>
            <span :class="{ selected: activePreview === 1 }"
              ><NavIcons name="tools" /> 课堂工具</span
            >
            <span :class="{ selected: activePreview === 2 }"
              ><NavIcons name="knowledge" /> 成绩分析</span
            >
            <small>有序的日常，从这里开始。</small>
          </aside>
          <div class="preview-content" aria-live="polite">
            <Transition name="preview-scene" mode="out-in">
              <div :key="activePreview" class="preview-scene">
                <template v-if="activePreview === 0">
                  <div class="dashboard-heading">
                    <div>
                      <p class="mini-eyebrow">新的一天，准备就绪</p>
                      <h2>
                        早上好，林老师
                        <span class="sun" aria-hidden="true">☀</span>
                      </h2>
                      <p>今天的教学安排，一目了然。</p>
                    </div>
                    <span class="date-chip">9 月 7 日 · 周一</span>
                  </div>
                  <div class="stats">
                    <div>
                      <span>管理班级</span><strong>3 <small>个</small></strong>
                    </div>
                    <div>
                      <span>今日课程</span><strong>4 <small>节</small></strong>
                    </div>
                    <div>
                      <span>待办事项</span><strong>2 <small>项</small></strong>
                    </div>
                  </div>
                  <div class="dashboard-grid">
                    <div class="schedule-demo">
                      <h3>今日日程 <span>查看课表 ↗</span></h3>
                      <div class="lesson">
                        <time>08:00<small>08:45</small></time>
                        <div>
                          <strong>语文 · 七年级（1）班</strong
                          ><span>第一节课 / 教学楼 301</span>
                        </div>
                        <b>课程</b>
                      </div>
                      <div class="lesson green">
                        <time>10:00<small>10:45</small></time>
                        <div>
                          <strong>语文 · 七年级（2）班</strong
                          ><span>第三节课 / 教学楼 302</span>
                        </div>
                        <b>课程</b>
                      </div>
                      <div class="lesson muted">
                        <time>14:00<small>14:40</small></time>
                        <div>
                          <strong>年级组教研</strong
                          ><span>教研室 / 集体备课</span>
                        </div>
                        <b>活动</b>
                      </div>
                    </div>
                    <div class="todo-demo">
                      <h3>手边的待办 <span>02</span></h3>
                      <p><i></i>整理本周阅读材料</p>
                      <p><i></i>准备单元复习教案</p>
                      <p class="done"><i>✓</i>录入随堂测验成绩</p>
                      <div class="gentle-note">
                        事情一件件完成，<br />教学一天天向前。
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else-if="activePreview === 1">
                  <div class="dashboard-heading">
                    <div>
                      <p class="mini-eyebrow">让每个人都有参与感</p>
                      <h2>今天，换一种课堂打开方式</h2>
                      <p>七年级（1）班 · 课堂工具</p>
                    </div>
                  </div>
                  <div class="tools-demo">
                    <div class="draw-demo">
                      <span>随机抽签 / 不重复模式</span>
                      <div class="student-avatar">林</div>
                      <h3>林小满</h3>
                      <p>下一次表达，交给新的声音。</p>
                      <small>抽签结果示意</small>
                    </div>
                    <div class="seats-demo">
                      <h3>座位方案 <span>讲台方向 ↑</span></h3>
                      <div class="seat-grid">
                        <span
                          v-for="n in 24"
                          :key="n"
                          :class="{ fixed: [2, 5, 13].includes(n) }"
                          >{{ String(n).padStart(2, "0") }}</span
                        >
                      </div>
                      <p><i></i> 固定座位 <span>多套方案，按需切换</span></p>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div class="dashboard-heading">
                    <div>
                      <p class="mini-eyebrow">每一步成长，都值得看见</p>
                      <h2>让变化有迹可循</h2>
                      <p>七年级（1）班 · 语文成绩分析</p>
                    </div>
                    <span class="date-chip">班级视角</span>
                  </div>
                  <div class="stats">
                    <div><span>本次平均分</span><strong>82.6</strong></div>
                    <div>
                      <span>及格率</span><strong>95<small>%</small></strong>
                    </div>
                    <div>
                      <span>有效成绩</span><strong>40 <small>人</small></strong>
                    </div>
                  </div>
                  <div class="chart-demo">
                    <h3>班级均分趋势 <span>持续了解学习状态</span></h3>
                    <svg
                      viewBox="0 0 620 140"
                      role="img"
                      aria-label="示例班级均分：第一次72分，第二次78分，第三次75分，第四次82.6分"
                    >
                      <path
                        class="chart-grid"
                        d="M20 25H600M20 65H600M20 105H600"
                      />
                      <path
                        class="chart-area"
                        d="M30 110L210 62L390 85L580 28V130H30Z"
                      />
                      <path
                        class="chart-line"
                        d="M30 110L210 62L390 85L580 28"
                      />
                      <circle
                        v-for="point in [
                          [30, 110],
                          [210, 62],
                          [390, 85],
                          [580, 28],
                        ]"
                        :key="point[0]"
                        :cx="point[0]"
                        :cy="point[1]"
                        r="5"
                      />
                    </svg>
                    <div class="chart-labels">
                      <span>第一次测验</span><span>第二次测验</span
                      ><span>第三次测验</span><span>第四次测验</span>
                    </div>
                  </div>
                </template>
              </div>
            </Transition>
          </div>
        </div>
      </div>
      <div class="preview-switcher" role="group" aria-label="切换产品功能示意">
        <button
          v-for="(label, index) in previews"
          :key="label"
          :aria-pressed="activePreview === index"
          :class="{ active: activePreview === index }"
          @click="activePreview = index"
        >
          <span>0{{ index + 1 }}</span
          >{{ label }}
        </button>
      </div>
    </section>

    <section id="features" class="features-section wrap">
      <div class="section-heading">
        <div>
          <p class="eyebrow">LESS BUSYWORK. MORE TEACHING.</p>
          <h2>教学的大小事，<br />都有一个好位置。</h2>
        </div>
        <p>从课前准备到课后回顾，<br />把分散的工作，连成顺手的日常。</p>
      </div>
      <div class="feature-grid">
        <article
          v-for="feature in features"
          :key="feature.number"
          class="feature-card"
        >
          <div class="feature-top">
            <span class="feature-icon"><NavIcons :name="feature.icon" /></span
            ><span>{{ feature.number }}</span>
          </div>
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.text }}</p>
          <div class="feature-tags">
            <span v-for="tag in feature.tags" :key="tag">{{ tag }}</span>
          </div>
        </article>
      </div>
    </section>

    <section id="knowledge" class="knowledge-section wrap">
      <div class="knowledge-copy">
        <p class="eyebrow">你的教学积累，值得好好收藏</p>
        <h2>好资料不再散落，<br />好经验不断积累。</h2>
        <p>
          教材、课件、教案、图片与错题，收进自己的知识中心。用知识点和标签整理，用搜索和收藏快速找回，让每一次备课都有积累可循。
        </p>
        <a href="#questions" class="text-link"
          >了解如何开始 <span aria-hidden="true">↗</span></a
        >
      </div>
      <div class="library-demo" aria-label="知识中心功能示意">
        <div class="library-heading">
          <span><NavIcons name="knowledge" /> 我的知识中心</span
          ><small>示例资源</small>
        </div>
        <div class="search-demo">⌕ <span>找到下一堂课的灵感</span></div>
        <div
          v-for="resource in [
            {
              ext: 'PPT',
              name: '第一单元 · 阅读与表达',
              info: '课件 / 七年级语文',
              color: 'orange',
            },
            {
              ext: 'DOC',
              name: '让课堂讨论真正发生',
              info: '教案 / 课堂设计',
              color: 'blue',
            },
            {
              ext: 'PDF',
              name: '古诗文阅读素材集',
              info: '教材 / 阅读积累',
              color: 'green',
            },
          ]"
          :key="resource.ext"
          class="resource-row"
        >
          <span :class="['file-icon', resource.color]">{{ resource.ext }}</span>
          <div>
            <strong>{{ resource.name }}</strong
            ><small>{{ resource.info }}</small>
          </div>
          <span class="bookmark" aria-hidden="true">☆</span>
        </div>
        <div class="library-tags">
          <span>知识点分类</span><span>标签整理</span><span>收藏与检索</span>
        </div>
      </div>
    </section>

    <section class="everywhere wrap">
      <p class="eyebrow">在办公桌前，也在课堂之间</p>
      <h2>打开，就是熟悉的工作台。</h2>
      <div class="benefits">
        <article>
          <span>01 / 随手可用</span>
          <h3>电脑安排，手机查看</h3>
          <p>浏览器即可打开，也可添加到主屏幕，让教学安排随身同行。</p>
        </article>
        <article>
          <span>02 / 断网不慌</span>
          <h3>已缓存的信息，离线可读</h3>
          <p>班级、学生、今日日程与当前座位图，缓存后在离线时仍可查看。</p>
        </article>
        <article>
          <span>03 / 自己的空间</span>
          <h3>每位老师，独立工作台</h3>
          <p>账号之间的数据相互隔离，还可查看登录设备并管理登录会话。</p>
        </article>
      </div>
    </section>

    <section id="questions" class="faq-section wrap">
      <div>
        <p class="eyebrow">开始之前</p>
        <h2>你可能想了解</h2>
        <p>关于使用的一些小问题。</p>
      </div>
      <div class="faq-list">
        <details v-for="faq in faqs" :key="faq.question">
          <summary>{{ faq.question }}<span aria-hidden="true">+</span></summary>
          <p>{{ faq.answer }}</p>
        </details>
      </div>
    </section>

    <section class="closing wrap">
      <span class="closing-mark" aria-hidden="true"
        ><NavIcons name="logo"
      /></span>
      <p class="eyebrow">给日常一点秩序，给教学多一点空间</p>
      <h2>下一堂好课，从从容容开始。</h2>
      <RouterLink :to="startRoute" class="action primary"
        >{{ auth.isAuthenticated ? "进入我的工作台" : "创建我的工作台" }}
        <span aria-hidden="true">↗</span></RouterLink
      >
      <p v-if="!auth.isAuthenticated" class="closing-note">
        准备好邀请码，就可以开始了。
      </p>
    </section>
    <footer class="about-footer wrap">
      <RouterLink to="/about" class="footer-brand"
        >教师工作台 <span>TeacherDesk</span></RouterLink
      >
      <p>让日常更有序，把时间留给教学。</p>
      <a href="#intro">回到顶部 ↑</a>
    </footer>
  </div>
</template>

<style scoped>
.about-page {
  --ink: #23332f;
  --muted: #737b77;
  --blue: #3569dc;
  --line: #e3e6df;
  background: #fafbf7;
  color: var(--ink);
  color-scheme: light;
  font-size: 14px;
  overflow: hidden;
}
.wrap {
  width: min(1120px, calc(100% - 80px));
  margin-inline: auto;
}
.about-page a {
  color: inherit;
}
.about-page a:hover {
  text-decoration: none;
}
.about-page a:focus-visible,
.about-page button:focus-visible,
.about-page summary:focus-visible {
  outline: 3px solid #3569dc;
  outline-offset: 5px;
}
.about-header {
  height: 102px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
}
.wordmark {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.4;
}
.wordmark small {
  display: block;
  font-size: 10px;
  letter-spacing: 1.6px;
  font-weight: 500;
  color: var(--muted);
}
.logo {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  background: var(--ink);
  color: #f7f9ea;
  border-radius: 13px;
}
.logo svg {
  width: 27px;
  height: 27px;
}
.header-links {
  display: flex;
  gap: 34px;
  color: #606a64;
  font-size: 13px;
}
.header-links a:hover,
.text-link:hover {
  color: var(--blue);
}
.login-link {
  font-size: 13px;
  font-weight: 600;
}
.login-link span {
  margin-left: 12px;
}
.hero {
  position: relative;
  padding-top: 76px;
}
.hero-copy {
  text-align: center;
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 2px;
  font-weight: 600;
  color: #667768;
  margin: 0 0 22px;
}
.status-dot {
  display: inline-block;
  background: #779d5a;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 9px;
}
.hero h1 {
  font-size: clamp(36px, 4.6vw, 60px);
  line-height: 1.4;
  letter-spacing: -2px;
  font-weight: 650;
}
.underlined {
  position: relative;
  color: var(--blue);
  white-space: nowrap;
}
.underlined:after {
  content: "";
  position: absolute;
  left: 0;
  bottom: -9px;
  width: 100%;
  height: 9px;
  border-top: 3px solid #a3bded;
  border-radius: 50%;
  transform: rotate(-2deg);
}
.hero-description {
  font-size: 16px;
  line-height: 1.9;
  color: var(--muted);
  margin: 29px 0;
}
.hero-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}
.action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 30px;
  padding: 14px 24px;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 600;
  transition:
    transform 0.2s,
    background 0.2s;
}
.action:hover {
  transform: translateY(-2px);
}
.about-page .primary {
  background: var(--blue);
  color: white;
  box-shadow: 0 5px 12px #3569dc18;
}
.about-page .primary:hover {
  background: #2858c0;
}
.secondary {
  border: 1px solid #dce1d8;
  background: #fff;
}
.hero-note {
  font-size: 11px;
  color: #838b83;
  margin: 19px 0 43px;
}
.hero-note span {
  margin: 0 10px;
}
.margin-note {
  position: absolute;
  right: 10px;
  top: 135px;
  transform: rotate(9deg);
  font-size: 13px;
  letter-spacing: 2px;
  color: #8a967c;
  display: flex;
  flex-direction: column;
}
.margin-note svg {
  width: 95px;
  height: 60px;
  stroke: #8a967c;
  stroke-width: 1.5;
  fill: none;
}
.product-preview {
  scroll-margin-top: 24px;
  border: 1px solid #dce2d8;
  border-radius: 12px;
  background: white;
  box-shadow: 0 20px 55px #23332f0b;
  overflow: hidden;
  text-align: left;
}
.preview-top {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  border-bottom: 1px solid #e8ece6;
  background: #f2f4ef;
  color: #899188;
  font-size: 10px;
}
.window-dots {
  display: flex;
  gap: 5px;
}
.window-dots i {
  width: 7px;
  height: 7px;
  background: #d2d8cc;
  border-radius: 50%;
}
.window-dots i:first-child {
  background: #dfa89c;
}
.window-dots i:nth-child(2) {
  background: #dfc58f;
}
.preview-body {
  display: grid;
  grid-template-columns: 182px 1fr;
  min-height: 425px;
}
.preview-sidebar {
  padding: 25px 16px 16px;
  border-right: 1px solid #edf0ea;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  color: #788279;
}
.preview-sidebar > span {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 5px;
}
.preview-sidebar svg {
  width: 16px;
  height: 16px;
}
.preview-sidebar .mini-brand {
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 21px;
  padding-left: 5px;
}
.preview-sidebar .selected {
  background: #eaf0fd;
  color: var(--blue);
}
.preview-sidebar small {
  font-size: 9px;
  margin-top: auto;
  padding: 30px 3px 0;
  color: #929a91;
}
.preview-content {
  padding: 28px;
  background: #f8faf7;
  min-width: 0;
}
.dashboard-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 21px;
}
.mini-eyebrow {
  font-size: 9px;
  letter-spacing: 1px;
  color: #929a90;
  margin: 0 0 5px;
}
.dashboard-heading h2 {
  font-size: 21px;
}
.sun {
  color: #d3a754;
  margin-left: 5px;
}
.dashboard-heading p:last-child {
  font-size: 10px;
  color: #8a938a;
  margin: 7px 0 0;
}
.date-chip {
  font-size: 10px;
  border: 1px solid #e2e7dd;
  border-radius: 5px;
  background: white;
  padding: 6px 10px;
  color: #788377;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 19px;
}
.stats > div {
  padding: 13px 18px;
  background: white;
  border: 1px solid #e6eae2;
  border-radius: 7px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.stats span {
  font-size: 11px;
  color: #798276;
}
.stats strong {
  font-size: 25px;
  font-weight: 600;
}
.stats small {
  font-size: 10px;
  font-weight: 400;
  color: #97a08f;
}
.dashboard-grid {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 15px;
}
.schedule-demo,
.todo-demo,
.chart-demo,
.draw-demo,
.seats-demo {
  background: white;
  border: 1px solid #e6eae2;
  border-radius: 7px;
  padding: 16px;
}
.preview-content h3 {
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 15px;
}
.preview-content h3 > span {
  font-size: 9px;
  font-weight: 400;
  color: #8b9585;
}
.lesson {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
  font-size: 10px;
}
.lesson time {
  font-size: 10px;
  color: #687360;
  min-width: 35px;
}
.lesson time small {
  display: block;
  font-size: 8px;
  color: #a4ab9e;
}
.lesson > div {
  flex: 1;
  padding: 7px 9px;
  background: #edf2fc;
  border-left: 2px solid #7494da;
  border-radius: 3px;
}
.lesson strong {
  font-weight: 500;
  font-size: 10px;
}
.lesson div > span {
  display: block;
  font-size: 8px;
  color: #8b95a6;
  margin-top: 3px;
}
.lesson b {
  font-size: 8px;
  font-weight: 400;
  color: #7c8b74;
}
.lesson.green > div {
  background: #eff5eb;
  border-color: #9bb78e;
}
.lesson.muted > div {
  background: #f5f2eb;
  border-color: #c8b58a;
}
.todo-demo p {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: #64705d;
  margin: 14px 0;
}
.todo-demo i {
  display: grid;
  place-items: center;
  font-style: normal;
  width: 12px;
  height: 12px;
  border: 1px solid #d9e0d1;
  border-radius: 3px;
}
.todo-demo .done {
  color: #a7ad9f;
  text-decoration: line-through;
}
.done i {
  background: #e9efdf;
}
.gentle-note {
  font-size: 10px;
  line-height: 1.9;
  color: #9da38b;
  padding-top: 9px;
  border-top: 1px dashed #e7eadf;
}
.preview-switcher {
  display: flex;
  justify-content: center;
  gap: 40px;
  padding: 25px 0 0;
}
.preview-switcher button {
  font: inherit;
  font-size: 12px;
  border: 0;
  background: transparent;
  color: #889082;
  padding: 10px 0;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.preview-switcher button span {
  font-size: 10px;
  margin-right: 9px;
  opacity: 0.65;
}
.preview-switcher button.active {
  color: var(--ink);
  border-bottom-color: var(--ink);
}
.tools-demo {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 16px;
}
.draw-demo {
  text-align: center;
  padding: 24px;
}
.draw-demo > span,
.draw-demo p,
.draw-demo small {
  font-size: 10px;
  color: var(--muted);
}
.student-avatar {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: #ecf1dd;
  color: #6e8150;
  font-size: 27px;
  margin: 19px auto 12px;
}
.draw-demo h3 {
  display: block;
  font-size: 20px;
  margin-bottom: 9px;
}
.seat-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 9px;
  margin: 23px 0;
}
.seat-grid > span {
  display: grid;
  place-items: center;
  height: 30px;
  border: 1px solid #dfe6db;
  border-radius: 5px;
  color: #97a08f;
  font-size: 10px;
}
.seat-grid .fixed {
  background: #e9efff;
  border-color: #a4b9ec;
  color: #4772c3;
}
.seats-demo p {
  font-size: 9px;
  color: var(--muted);
}
.seats-demo p > span {
  float: right;
}
.seats-demo i {
  display: inline-block;
  background: #a4b9ec;
  width: 6px;
  height: 6px;
}
.chart-demo svg {
  width: 100%;
  height: 140px;
  overflow: visible;
}
.chart-grid {
  fill: none;
  stroke: #e9ede5;
  stroke-dasharray: 4 4;
}
.chart-area {
  fill: #edf2fd;
}
.chart-line {
  fill: none;
  stroke: #527fd4;
  stroke-width: 3;
}
.chart-demo circle {
  fill: white;
  stroke: #527fd4;
  stroke-width: 3;
}
.chart-labels {
  display: flex;
  justify-content: space-between;
  color: #929a8c;
  font-size: 9px;
}
.features-section {
  padding-top: 110px;
}
.section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  margin-bottom: 37px;
}
.about-page section:not(.hero) h2 {
  font-size: 34px;
  line-height: 1.55;
  letter-spacing: -1px;
}
.section-heading > p {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.9;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.feature-card {
  padding: 30px 32px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fffefa;
}
.feature-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  color: #b1b7aa;
  font-size: 12px;
}
.feature-icon {
  display: grid;
  place-items: center;
  width: 39px;
  height: 39px;
  background: #edf1e7;
  border-radius: 10px;
  color: #687a56;
}
.feature-icon svg {
  width: 21px;
  height: 21px;
}
.feature-card:nth-child(2) .feature-icon {
  background: #edf2ff;
  color: #6488c4;
}
.feature-card:nth-child(3) .feature-icon {
  background: #faf0e3;
  color: #b49363;
}
.feature-card:nth-child(4) .feature-icon {
  background: #f0edf9;
  color: #9a85b7;
}
.feature-card h3 {
  font-size: 19px;
}
.feature-card > p {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.9;
  max-width: 420px;
  margin: 13px 0 23px;
}
.feature-tags {
  display: flex;
  gap: 9px;
  flex-wrap: wrap;
}
.feature-tags span {
  font-size: 10px;
  background: #f3f4ee;
  border-radius: 4px;
  padding: 4px 9px;
  color: #7d8674;
}
.knowledge-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 80px;
  align-items: center;
  padding: 90px 0;
}
.knowledge-copy > p:not(.eyebrow) {
  font-size: 14px;
  color: var(--muted);
  line-height: 2;
  margin: 23px 0;
}
.text-link {
  display: inline-flex;
  gap: 30px;
  font-size: 12px;
  font-weight: 600;
}
.library-demo {
  padding: 25px;
  background: #eef1e7;
  border: 1px solid #e0e5d7;
  border-radius: 12px;
  transform: rotate(-2deg);
}
.library-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.library-heading > span {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  font-weight: 600;
}
.library-heading svg {
  width: 18px;
  height: 18px;
}
.library-heading small {
  font-size: 9px;
  color: #8c9581;
}
.search-demo {
  padding: 9px 12px;
  background: #ffffff8c;
  border: 1px solid #e1e5d9;
  border-radius: 6px;
  color: #97a08b;
  margin-bottom: 14px;
}
.search-demo span {
  font-size: 10px;
  margin-left: 8px;
}
.resource-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: #fffefa;
  border: 1px solid #e6e9dd;
  border-radius: 6px;
  margin: 8px 0;
}
.file-icon {
  font-size: 9px;
  font-weight: 600;
  padding: 11px 6px;
  border-radius: 5px;
}
.orange {
  background: #faf0e6;
  color: #bb885b;
}
.blue {
  background: #edf1fb;
  color: #698cce;
}
.green {
  background: #edf1e6;
  color: #849466;
}
.resource-row strong {
  display: block;
  font-size: 11px;
  font-weight: 500;
}
.resource-row small {
  display: block;
  font-size: 9px;
  color: #a0a692;
  margin-top: 3px;
}
.bookmark {
  margin-left: auto;
  color: #a2ac91;
  font-size: 22px;
}
.library-tags {
  display: flex;
  gap: 18px;
  margin-top: 20px;
  font-size: 9px;
  color: #889576;
}
.everywhere {
  border-block: 1px solid var(--line);
  padding-block: 55px;
}
.everywhere > .eyebrow,
.everywhere > h2 {
  text-align: center;
}
.benefits {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 45px;
  margin-top: 42px;
}
.benefits article + article {
  border-left: 1px solid var(--line);
  padding-left: 35px;
}
.benefits article > span {
  font-size: 10px;
  color: #9ba48d;
  letter-spacing: 1px;
}
.benefits h3 {
  font-size: 16px;
  margin: 13px 0 10px;
}
.benefits p {
  font-size: 12px;
  line-height: 1.9;
  color: var(--muted);
  margin: 0;
}
.faq-section {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 65px;
  padding-block: 85px;
}
.faq-section > div > p:not(.eyebrow) {
  color: var(--muted);
  font-size: 13px;
}
.faq-list details {
  border-bottom: 1px solid var(--line);
}
.faq-list summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  font-size: 13px;
  font-weight: 500;
  padding: 20px 0;
}
.faq-list summary::-webkit-details-marker {
  display: none;
}
.faq-list summary span {
  font-size: 21px;
  font-weight: 300;
  color: #98a08e;
}
.faq-list details[open] summary span {
  transform: rotate(45deg);
}
.faq-list details p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.9;
  margin: 0 24px 22px 0;
}
.closing {
  text-align: center;
  background: #edf1e5;
  border: 1px solid #e3e8d9;
  border-radius: 14px;
  padding: 45px 24px;
}
.closing-mark {
  display: block;
  margin-bottom: 20px;
  color: #839369;
}
.closing-mark svg {
  width: 36px;
  height: 36px;
}
.closing .eyebrow {
  font-size: 10px;
  margin-bottom: 12px;
}
.closing .action {
  margin-top: 25px;
}
.closing-note {
  font-size: 10px;
  color: #8d9780;
  margin: 14px 0 0;
}
.about-footer {
  padding-block: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  color: #929b88;
}
.footer-brand {
  font-weight: 600;
  color: var(--ink) !important;
  font-size: 12px;
}
.footer-brand span {
  font-weight: 400;
  font-size: 10px;
  margin-left: 8px;
  color: #929b88;
}
.about-footer p {
  margin: 0;
}
.skip-link {
  position: fixed;
  left: 20px;
  top: -100px;
  padding: 12px;
  background: white;
  z-index: 100;
}
.skip-link:focus {
  top: 12px;
}
section[id] {
  scroll-margin-top: 25px;
}
@media (min-width: 1500px) {
  .hero {
    padding-top: 95px;
  }
  .hero-note {
    margin-bottom: 55px;
  }
}
@media (max-width: 1000px) {
  .margin-note {
    display: none;
  }
  .wrap {
    width: calc(100% - 48px);
  }
  .preview-sidebar {
    padding-inline: 10px;
  }
  .preview-body {
    grid-template-columns: 150px 1fr;
  }
  .preview-content {
    padding: 20px;
  }
  .preview-sidebar .mini-brand {
    font-size: 10px;
  }
  .dashboard-grid {
    grid-template-columns: 1.3fr 1fr;
  }
  .lesson {
    gap: 6px;
  }
  .lesson b {
    display: none;
  }
  .knowledge-section {
    gap: 40px;
  }
  .header-links {
    gap: 20px;
  }
  .benefits {
    gap: 25px;
  }
  .benefits article + article {
    padding-left: 25px;
  }
}
@media (max-width: 700px) {
  .wrap {
    width: calc(100% - 36px);
  }
  .about-header {
    height: 80px;
  }
  .wordmark {
    font-size: 15px;
    gap: 8px;
  }
  .wordmark small {
    font-size: 8px;
  }
  .logo {
    width: 34px;
    height: 34px;
    border-radius: 10px;
  }
  .logo svg {
    width: 23px;
    height: 23px;
  }
  .header-links {
    display: none;
  }
  .login-link {
    font-size: 11px;
  }
  .hero {
    padding-top: 47px;
  }
  .eyebrow {
    font-size: 9px;
    letter-spacing: 1px;
    margin-bottom: 18px;
  }
  .hero h1 {
    font-size: 36px;
    letter-spacing: -1.5px;
  }
  .hero-description {
    font-size: 13px;
    margin: 25px 0;
    line-height: 1.9;
  }
  .desktop-break {
    display: none;
  }
  .hero-actions {
    gap: 8px;
  }
  .action {
    font-size: 12px;
    padding: 13px 17px;
    gap: 17px;
  }
  .hero-note {
    font-size: 9px;
    line-height: 1.8;
    margin: 17px 0 30px;
  }
  .hero-note span {
    margin: 0 4px;
  }
  .preview-top {
    padding-inline: 12px;
    font-size: 8px;
    height: 32px;
  }
  .preview-top > span:nth-child(2) {
    display: none;
  }
  .preview-body {
    display: block;
    min-height: 470px;
  }
  .preview-sidebar {
    display: none;
  }
  .preview-content {
    padding: 18px 13px;
    min-height: 470px;
  }
  .dashboard-heading {
    margin-bottom: 17px;
  }
  .dashboard-heading h2 {
    font-size: 16px;
  }
  .date-chip {
    font-size: 8px;
    padding: 5px;
  }
  .dashboard-heading p:last-child {
    font-size: 9px;
  }
  .mini-eyebrow {
    font-size: 8px;
  }
  .stats {
    gap: 7px;
    margin-bottom: 12px;
  }
  .stats > div {
    padding: 10px;
    display: block;
  }
  .stats span {
    font-size: 9px;
  }
  .stats strong {
    display: block;
    font-size: 23px;
    margin-top: 3px;
  }
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  .schedule-demo,
  .todo-demo {
    padding: 12px;
  }
  .todo-demo {
    display: none;
  }
  .lesson {
    margin: 12px 0;
    gap: 12px;
  }
  .lesson b {
    display: block;
  }
  .lesson strong {
    font-size: 11px;
  }
  .lesson > div {
    padding: 10px;
  }
  .preview-switcher {
    gap: 0;
    justify-content: space-between;
    padding-top: 12px;
  }
  .preview-switcher button {
    font-size: 10px;
  }
  .preview-switcher button span {
    display: none;
  }
  .tools-demo {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .draw-demo {
    padding: 13px;
  }
  .student-avatar {
    width: 43px;
    height: 43px;
    font-size: 19px;
    margin: 9px auto;
  }
  .draw-demo h3 {
    font-size: 17px;
  }
  .draw-demo p {
    margin: 6px 0;
  }
  .draw-demo small {
    display: none;
  }
  .seats-demo {
    padding: 12px;
  }
  .seat-grid {
    margin: 12px 0;
    gap: 6px;
  }
  .seat-grid > span {
    height: 24px;
  }
  .seats-demo p {
    margin-bottom: 0;
  }
  .chart-demo {
    padding: 14px 10px;
  }
  .chart-demo svg {
    height: 190px;
  }
  .features-section {
    padding-top: 65px;
  }
  .section-heading {
    display: block;
    margin-bottom: 25px;
  }
  .about-page section:not(.hero) h2 {
    font-size: 27px;
    letter-spacing: -0.5px;
  }
  .section-heading > p {
    font-size: 12px;
    margin-top: 16px;
  }
  .section-heading > p br {
    display: none;
  }
  .feature-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .feature-card {
    padding: 24px;
  }
  .feature-top {
    margin-bottom: 18px;
  }
  .feature-card h3 {
    font-size: 17px;
  }
  .feature-card > p {
    font-size: 12px;
    margin-bottom: 17px;
  }
  .knowledge-section {
    grid-template-columns: 1fr;
    gap: 30px;
    padding-block: 60px;
  }
  .knowledge-copy > p:not(.eyebrow) {
    font-size: 13px;
  }
  .library-demo {
    transform: none;
    padding: 20px;
  }
  .everywhere {
    padding-block: 40px;
  }
  .benefits {
    grid-template-columns: 1fr;
    gap: 25px;
    margin-top: 30px;
  }
  .benefits article + article {
    border-left: 0;
    padding-left: 0;
    border-top: 1px solid var(--line);
    padding-top: 25px;
  }
  .benefits h3 {
    margin-top: 8px;
  }
  .faq-section {
    grid-template-columns: 1fr;
    gap: 12px;
    padding-block: 55px;
  }
  .faq-list summary {
    font-size: 12px;
  }
  .closing {
    padding: 35px 16px;
  }
  .about-page .closing h2 {
    font-size: 23px;
  }
  .about-footer {
    flex-wrap: wrap;
    gap: 16px;
    padding-block: 25px;
  }
  .about-footer p {
    order: 3;
    width: 100%;
    font-size: 10px;
  }
}
/* Motion stays local to the introduction page and uses composited transforms. */
.about-page {
  --motion-ease: cubic-bezier(0.22, 1, 0.36, 1);
  isolation: isolate;
}
.reading-progress {
  position: fixed;
  inset: 0 0 auto;
  height: 3px;
  background: linear-gradient(90deg, #789d77, #3569dc, #a8bfe9);
  transform: scaleX(var(--reading-progress, 0));
  transform-origin: left;
  z-index: 100;
  pointer-events: none;
}
.hero::before,
.hero::after {
  content: "";
  position: absolute;
  pointer-events: none;
  z-index: -1;
  border-radius: 50%;
}
.hero::before {
  width: min(850px, 100vw);
  height: 640px;
  top: -60px;
  left: -180px;
  background: radial-gradient(ellipse, #e1eaca85, transparent 68%);
  animation: ambient-drift 16s ease-in-out infinite alternate;
}
.hero::after {
  width: min(750px, 100vw);
  height: 660px;
  top: 120px;
  right: -190px;
  background: radial-gradient(ellipse, #dce8fc90, transparent 68%);
  animation: ambient-drift 20s ease-in-out -8s infinite alternate-reverse;
}
.hero-copy > *,
.about-header,
.product-preview,
.preview-switcher {
  animation: entrance 1s var(--motion-ease) both;
}
.about-header {
  animation-duration: 0.8s;
}
.hero-copy > :nth-child(1) {
  animation-delay: 0.08s;
}
.hero-copy > :nth-child(2) {
  animation-delay: 0.18s;
}
.hero-copy > :nth-child(3) {
  animation-delay: 0.3s;
}
.hero-copy > :nth-child(4) {
  animation-delay: 0.42s;
}
.hero-copy > :nth-child(5) {
  animation-delay: 0.5s;
}
.product-preview {
  animation-delay: 0.55s;
}
.preview-switcher {
  animation-delay: 0.65s;
}
.underlined::after {
  transform-origin: left;
  animation: underline-draw 1.1s var(--motion-ease) 0.65s both;
}
.margin-note {
  animation: note-float 7s ease-in-out infinite;
}
.status-dot {
  box-shadow: 0 0 0 5px #779d5a12;
}
.motion-ready .scroll-reveal {
  opacity: 0;
  transform: translateY(34px);
  transition:
    opacity 0.85s var(--motion-ease),
    transform 0.85s var(--motion-ease);
}
.motion-ready .scroll-reveal.is-revealed,
.motion-ready .scroll-reveal:focus-within {
  opacity: 1;
  transform: translateY(0);
}
.motion-ready .feature-card:nth-child(even) {
  transition-delay: 0.12s;
}
.motion-ready .benefits article:nth-child(2) {
  transition-delay: 0.1s;
}
.motion-ready .benefits article:nth-child(3) {
  transition-delay: 0.2s;
}
.motion-ready .library-demo {
  transform: translateY(34px) rotate(-2deg);
}
.motion-ready .library-demo.is-revealed {
  transform: translateY(0) rotate(-2deg);
}
.preview-content {
  position: relative;
}
.preview-scene-enter-active {
  transition:
    opacity 0.45s ease,
    transform 0.55s var(--motion-ease);
}
.preview-scene-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.preview-scene-enter-from {
  opacity: 0;
  transform: translateY(14px);
}
.preview-scene-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.preview-scene .stats > div,
.preview-scene .lesson,
.preview-scene .seat-grid > span {
  animation: entrance 0.7s var(--motion-ease) both;
}
.preview-scene .stats > :nth-child(2),
.preview-scene .lesson:nth-child(3) {
  animation-delay: 0.08s;
}
.preview-scene .stats > :nth-child(3),
.preview-scene .lesson:nth-child(4) {
  animation-delay: 0.16s;
}
.seat-grid > :nth-child(3n) {
  animation-delay: 0.12s;
}
.seat-grid > :nth-child(3n + 1) {
  animation-delay: 0.2s;
}
.student-avatar {
  animation: avatar-arrive 0.85s var(--motion-ease) both;
}
.chart-line {
  stroke-dasharray: 650;
  stroke-dashoffset: 650;
  animation: chart-draw 1.5s var(--motion-ease) 0.15s forwards;
}
.chart-area {
  animation: soft-fade 1.2s ease 0.35s both;
}
.chart-demo circle {
  animation: soft-fade 0.6s ease 0.7s both;
}
.action {
  position: relative;
  overflow: hidden;
  transition:
    transform 0.35s var(--motion-ease),
    box-shadow 0.35s,
    background 0.25s;
}
.action > span,
.login-link > span,
.text-link > span {
  display: inline-block;
  transition: transform 0.3s var(--motion-ease);
}
.primary::after {
  content: "";
  position: absolute;
  inset: -50% auto -50% -65%;
  width: 40%;
  background: linear-gradient(90deg, transparent, #ffffff30, transparent);
  transform: skewX(-20deg);
  pointer-events: none;
}
.primary:hover::after {
  animation: button-sheen 0.75s ease;
}
.action:hover > span,
.login-link:hover > span,
.text-link:hover > span {
  transform: translate(3px, -3px);
}
.secondary:hover > span {
  transform: translateY(4px);
}
.header-links a {
  position: relative;
  padding-block: 6px;
}
.header-links a::after {
  content: "";
  position: absolute;
  height: 1px;
  inset: auto 0 0;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.3s var(--motion-ease);
}
.header-links a:hover::after {
  transform: scaleX(1);
}
.preview-switcher button {
  transition:
    color 0.25s,
    border-color 0.3s,
    transform 0.3s;
}
.preview-switcher button:hover {
  color: var(--blue);
  transform: translateY(-2px);
}
.feature-icon {
  transition:
    transform 0.45s var(--motion-ease),
    box-shadow 0.45s;
}
.feature-card {
  position: relative;
}
.feature-card::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  box-shadow: 0 18px 45px #23332f0c;
  opacity: 0;
  transition: opacity 0.4s;
}
.resource-row {
  transition:
    transform 0.35s var(--motion-ease),
    box-shadow 0.35s;
}
.faq-list summary span {
  transition: transform 0.35s var(--motion-ease);
}
.faq-list details[open] p {
  animation: entrance 0.4s var(--motion-ease);
}
.closing {
  position: relative;
  overflow: hidden;
}
.closing::before {
  content: "";
  position: absolute;
  width: 430px;
  height: 430px;
  border: 1px solid #7d966219;
  border-radius: 50%;
  right: -215px;
  top: -130px;
  box-shadow:
    0 0 0 45px #7d966207,
    0 0 0 90px #7d966206;
  pointer-events: none;
}
@media (hover: hover) and (pointer: fine) {
  .feature-card:hover::after {
    opacity: 1;
  }
  .feature-card:hover .feature-icon {
    transform: translateY(-4px) rotate(-6deg);
    box-shadow: 0 8px 18px #23332f0c;
  }
  .resource-row:hover {
    transform: translateX(6px);
    box-shadow: 0 5px 14px #23332f08;
  }
  .about-page .primary:hover {
    box-shadow: 0 9px 24px #3569dc30;
  }
}
@keyframes entrance {
  from {
    opacity: 0;
    transform: translateY(22px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes ambient-drift {
  from {
    transform: translate(0, 0) scale(1);
  }
  to {
    transform: translate(45px, 25px) scale(1.12);
  }
}
@keyframes underline-draw {
  from {
    transform: scaleX(0) rotate(-2deg);
  }
  to {
    transform: scaleX(1) rotate(-2deg);
  }
}
@keyframes note-float {
  0%,
  100% {
    transform: translateY(0) rotate(9deg);
  }
  50% {
    transform: translateY(-9px) rotate(6deg);
  }
}
@keyframes avatar-arrive {
  from {
    opacity: 0;
    transform: scale(0.8) rotate(-12deg);
  }
  to {
    opacity: 1;
    transform: scale(1) rotate(0);
  }
}
@keyframes chart-draw {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes soft-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes button-sheen {
  to {
    left: 130%;
  }
}
@media (max-width: 700px) {
  .hero::before,
  .hero::after {
    animation: none;
    opacity: 0.65;
  }
  .motion-ready .library-demo {
    transform: translateY(24px);
  }
  .motion-ready .library-demo.is-revealed {
    transform: none;
  }
  .motion-ready .feature-card:nth-child(even) {
    transition-delay: 0s;
  }
}
@media (prefers-reduced-motion: reduce) {
  .about-page *,
  .about-page *::before,
  .about-page *::after {
    animation: none !important;
    transition: none !important;
  }
  .chart-line {
    stroke-dashoffset: 0;
  }
  .motion-ready .scroll-reveal {
    opacity: 1;
    transform: none;
  }
  .action {
    transition: none;
  }
  .action:hover {
    transform: none;
  }
}

/* Follow the app theme, including an explicit choice and system preference. */
html[data-theme="dark"] .about-page {
  --ink: #e3ebe7;
  --muted: #acbab4;
  --blue: #8eb4ff;
  --line: #33413d;
  --about-surface: #192521;
  --about-raised: #22312c;
  background: #101916;
  color-scheme: dark;
}
html[data-theme="dark"] .about-page .logo {
  background: #dce8de;
  color: #20342b;
}
html[data-theme="dark"] .about-page .header-links,
html[data-theme="dark"] .about-page .eyebrow,
html[data-theme="dark"] .about-page .hero-note,
html[data-theme="dark"] .about-page .margin-note,
html[data-theme="dark"] .about-page .preview-top,
html[data-theme="dark"] .about-page .preview-sidebar,
html[data-theme="dark"] .about-page .preview-sidebar small,
html[data-theme="dark"] .about-page .mini-eyebrow,
html[data-theme="dark"] .about-page .dashboard-heading p:last-child,
html[data-theme="dark"] .about-page .date-chip,
html[data-theme="dark"] .about-page .stats span,
html[data-theme="dark"] .about-page .stats small,
html[data-theme="dark"] .about-page .preview-content h3 > span,
html[data-theme="dark"] .about-page .lesson time,
html[data-theme="dark"] .about-page .lesson time small,
html[data-theme="dark"] .about-page .lesson div > span,
html[data-theme="dark"] .about-page .lesson b,
html[data-theme="dark"] .about-page .todo-demo p,
html[data-theme="dark"] .about-page .todo-demo .done,
html[data-theme="dark"] .about-page .gentle-note,
html[data-theme="dark"] .about-page .preview-switcher button,
html[data-theme="dark"] .about-page .seat-grid > span,
html[data-theme="dark"] .about-page .chart-labels,
html[data-theme="dark"] .about-page .feature-top,
html[data-theme="dark"] .about-page .feature-tags span,
html[data-theme="dark"] .about-page .library-heading small,
html[data-theme="dark"] .about-page .search-demo,
html[data-theme="dark"] .about-page .resource-row small,
html[data-theme="dark"] .about-page .bookmark,
html[data-theme="dark"] .about-page .library-tags,
html[data-theme="dark"] .about-page .benefits article > span,
html[data-theme="dark"] .about-page .faq-list summary span,
html[data-theme="dark"] .about-page .closing-mark,
html[data-theme="dark"] .about-page .closing-note,
html[data-theme="dark"] .about-page .about-footer,
html[data-theme="dark"] .about-page .footer-brand span {
  color: var(--muted);
}
html[data-theme="dark"] .about-page .margin-note svg {
  stroke: #acbab4;
}
html[data-theme="dark"] .about-page .primary {
  background: #91b6ff;
  color: #10213c;
  box-shadow: 0 5px 20px #00000025;
}
html[data-theme="dark"] .about-page .primary:hover {
  background: #adc9ff;
  color: #10213c;
}
html[data-theme="dark"] .about-page a:focus-visible,
html[data-theme="dark"] .about-page button:focus-visible,
html[data-theme="dark"] .about-page summary:focus-visible {
  outline-color: #91b6ff;
}
html[data-theme="dark"] .about-page .secondary,
html[data-theme="dark"] .about-page .product-preview,
html[data-theme="dark"] .about-page .date-chip,
html[data-theme="dark"] .about-page .stats > div,
html[data-theme="dark"] .about-page .schedule-demo,
html[data-theme="dark"] .about-page .todo-demo,
html[data-theme="dark"] .about-page .chart-demo,
html[data-theme="dark"] .about-page .draw-demo,
html[data-theme="dark"] .about-page .seats-demo,
html[data-theme="dark"] .about-page .feature-card,
html[data-theme="dark"] .about-page .resource-row,
html[data-theme="dark"] .about-page .skip-link {
  background: var(--about-surface);
  border-color: var(--line);
}
html[data-theme="dark"] .about-page .product-preview {
  box-shadow: 0 20px 55px #00000030;
}
html[data-theme="dark"] .about-page .preview-top,
html[data-theme="dark"] .about-page .library-demo,
html[data-theme="dark"] .about-page .closing {
  background: #1d2c25;
  border-color: var(--line);
}
html[data-theme="dark"] .about-page .preview-content {
  background: #131e1a;
}
html[data-theme="dark"] .about-page .preview-sidebar,
html[data-theme="dark"] .about-page .todo-demo i,
html[data-theme="dark"] .about-page .gentle-note,
html[data-theme="dark"] .about-page .seat-grid > span,
html[data-theme="dark"] .about-page .search-demo {
  border-color: #40524a;
}
html[data-theme="dark"] .about-page .preview-sidebar .selected,
html[data-theme="dark"] .about-page .seat-grid .fixed {
  background: #253b58;
  color: #b1cdff;
  border-color: #729add;
}
html[data-theme="dark"] .about-page .preview-sidebar .mini-brand,
html[data-theme="dark"] .about-page .preview-switcher button.active {
  color: var(--ink);
}
html[data-theme="dark"] .about-page .preview-switcher button.active {
  border-bottom-color: var(--ink);
}
html[data-theme="dark"] .about-page .preview-switcher button:hover {
  color: var(--blue);
}
html[data-theme="dark"] .about-page .lesson > div {
  background: #243449;
  border-color: #7faae8;
}
html[data-theme="dark"] .about-page .lesson.green,
html[data-theme="dark"] .about-page .lesson.muted {
  background: transparent;
  color: var(--ink);
}
html[data-theme="dark"] .about-page .lesson.green > div {
  background: #2c3c2d;
  border-color: #9bb78e;
}
html[data-theme="dark"] .about-page .lesson.muted > div {
  background: #3b3529;
  border-color: #c8b58a;
}
html[data-theme="dark"] .about-page .done i,
html[data-theme="dark"] .about-page .feature-tags span,
html[data-theme="dark"] .about-page .search-demo {
  background: var(--about-raised);
}
html[data-theme="dark"] .about-page .student-avatar,
html[data-theme="dark"] .about-page .feature-icon,
html[data-theme="dark"] .about-page .green {
  background: #30402e;
  color: #c1d8a8;
}
html[data-theme="dark"]
  .about-page
  .feature-card:nth-child(2)
  .feature-icon,
html[data-theme="dark"] .about-page .blue {
  background: #283c58;
  color: #b1cdff;
}
html[data-theme="dark"]
  .about-page
  .feature-card:nth-child(3)
  .feature-icon,
html[data-theme="dark"] .about-page .orange {
  background: #443627;
  color: #e7c296;
}
html[data-theme="dark"]
  .about-page
  .feature-card:nth-child(4)
  .feature-icon {
  background: #3b304c;
  color: #d2baee;
}
html[data-theme="dark"] .about-page .chart-grid {
  stroke: #3b4b43;
}
html[data-theme="dark"] .about-page .chart-area {
  fill: #253b51;
}
html[data-theme="dark"] .about-page .chart-line,
html[data-theme="dark"] .about-page .chart-demo circle {
  stroke: #96bcff;
}
html[data-theme="dark"] .about-page .chart-demo circle {
  fill: var(--about-surface);
}
html[data-theme="dark"] .about-page .underlined::after {
  border-color: #7297ce;
}
html[data-theme="dark"] .about-page .hero::before {
  background: radial-gradient(ellipse, #48624030, transparent 68%);
}
html[data-theme="dark"] .about-page .hero::after {
  background: radial-gradient(ellipse, #34588a38, transparent 68%);
}
html[data-theme="dark"] .about-page .closing::before {
  border-color: #a6c48a18;
  box-shadow:
    0 0 0 45px #a6c48a06,
    0 0 0 90px #a6c48a05;
}
html[data-theme="dark"] .about-page .feature-card::after {
  box-shadow: 0 18px 45px #00000026;
}
</style>
