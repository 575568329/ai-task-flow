// frontend/src/test/setup.ts
// vitest 全局 setup:仅由 *.test.tsx 组件测试需要(*.test.ts 纯函数测试不依赖 DOM)。
//  - 注册 @testing-library/jest-dom 的 vitest matcher(toBeInTheDocument 等)。
//  - jsdom 没有 ResizeObserver,@tanstack/react-virtual 依赖它跟踪滚动容器尺寸变化,
//    不 stub 会在 mount effect 里抛 NotFoundError;此处给一个 no-op 实现让生命周期跑通。
//  - jsdom 默认所有 HTMLElement 的 clientWidth/Height/scrollWidth/Height/scrollTop=0,
//    会让虚拟列表计算出 0 个可见项 → 复制按钮等交互元素根本不渲染。
//    这里给一个非零默认值(1024x768),让虚拟器渲染前 overscan 项,供交互测试断言。
//    「只渲染 N 条」等真实布局断言仍由 Task 5 手测覆盖,不在 jsdom 验证。
import '@testing-library/jest-dom/vitest';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const STUB_WIDTH = 1024;
const STUB_HEIGHT = 768;

// 注意:@tanstack/virtual-core 的 getRect 读 offsetWidth/offsetHeight(不是 clientWidth/Height),
// 同时 useVirtualizer 还会用 clientWidth/Height 与 scrollWidth/Height 做其它判断,
// 这里一并 stub。offsetWidth/Height 在 jsdom 默认为 0 → virtual-core 视外层尺寸为 0,
// range 计算时直接 return null,getVirtualItems() 为空 → 交互元素不渲染 → 用例失败。
Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { configurable: true, get: () => STUB_WIDTH },
  offsetHeight: { configurable: true, get: () => STUB_HEIGHT },
  clientWidth: { configurable: true, get: () => STUB_WIDTH },
  clientHeight: { configurable: true, get: () => STUB_HEIGHT },
  scrollWidth: { configurable: true, get: () => STUB_WIDTH },
  scrollHeight: { configurable: true, get: () => STUB_HEIGHT },
  scrollTop: { configurable: true, get: () => 0, set: () => {} },
});

// jsdom 没有 Element.scrollTo,虚拟列表 useEffect 内调用会抛 TypeError。
Element.prototype.scrollTo = () => {};
