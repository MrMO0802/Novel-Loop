import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { ApplicationShell } from '../shell/ApplicationShell';

interface RoutePlaceholderProps {
  title: string;
}

function RoutePlaceholder({ title }: RoutePlaceholderProps) {
  return (
    <section className="nl-route-placeholder" aria-labelledby="route-title">
      <h1 id="route-title">{title}</h1>
    </section>
  );
}

function SetupPlaceholder() {
  const [searchParams] = useSearchParams();
  const setupState = searchParams.get('state');
  const titleByState: Record<string, string> = {
    ready: '首次使用：准备就绪',
    missing: '首次使用：需要安装',
    login: '首次使用：需要登录',
    warning: '首次使用：需要处理'
  };

  return <RoutePlaceholder title={titleByState[setupState ?? ''] ?? '首次使用'} />;
}

export function PrototypeRoutes() {
  return (
    <Routes>
      <Route element={<ApplicationShell />}>
        <Route path="/setup" element={<SetupPlaceholder />} />
        <Route path="/library" element={<RoutePlaceholder title="作品库" />} />
        <Route path="/new" element={<RoutePlaceholder title="新建作品" />} />
        <Route path="/project/rain-radio" element={<RoutePlaceholder title="雨夜电台" />} />
        <Route path="/project/rain-radio/chapter/2" element={<RoutePlaceholder title="第二章：收件地址" />} />
        <Route path="/project/rain-radio/story-record" element={<RoutePlaceholder title="故事档案" />} />
        <Route path="/tasks" element={<RoutePlaceholder title="任务中心" />} />
        <Route path="/settings" element={<RoutePlaceholder title="设置" />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/library" />} />
    </Routes>
  );
}
