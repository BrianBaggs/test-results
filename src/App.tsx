import { useState } from 'react';
import { toast } from 'sonner';
import { Navbar } from './components/Layout/Navbar';
import { Dashboard } from './components/Dashboard/Dashboard';
import { ReportGenerator } from './components/ReportGenerator/ReportGenerator';
import { FailureAnalysisPage } from './components/FailureAnalysis/FailureAnalysisPage';
import { FailureAnalysisProgress } from './components/FailureAnalysis/FailureAnalysisProgress';
import { PublishPage } from './components/Publish/PublishPage';
import { SplitPage } from './components/Split/SplitPage';
import { ShardPage } from './components/Shard/ShardPage';
import { ReviewPage } from './components/Review/ReviewPage';
import { Toaster } from './components/ui/sonner';
import { syncProgressStorageForNewXml } from './utils/progressStorage';
import type { TestData } from './types';

export function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [testData, setTestData] = useState<TestData | null>(null);
  const [xmlContent, setXmlContent] = useState<string | null>(null);

  const handleDataUpload = (data: TestData) => {
    setTestData(data);
    syncProgressStorageForNewXml(data).then(({ cleared }) => {
      if (cleared) toast.success('Loaded a different XML file — previous failure-resolution progress was cleared.');
    });
  };

  // Combine already writes its own merged progress to storage (see SplitPage's
  // handleCombine), so this deliberately skips the same/different-XML check above.
  const handleCombinedDataUpload = (data: TestData) => {
    setTestData(data);
  };

  const handleXmlContent = (content: string) => {
    setXmlContent(content);
  };

  const getActiveComponent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard onDataUpload={handleDataUpload} onXmlContent={handleXmlContent} testData={testData} />;
      case 'failures':
        return <FailureAnalysisPage testData={testData} />;
      case 'progress':
        return <FailureAnalysisProgress testData={testData} />;
      case 'report':
        return <ReportGenerator testData={testData} setActiveTab={setActiveTab} />;
      case 'publish':
        return <PublishPage testData={testData} />;
      case 'review':
        return <ReviewPage />;
      case 'split':
        return <SplitPage xmlContent={xmlContent} onCombined={handleCombinedDataUpload} setActiveTab={setActiveTab} />;
      case 'shard':
        return <ShardPage onDataUpload={handleDataUpload} onXmlContent={handleXmlContent} setActiveTab={setActiveTab} />;
      default:
        return <Dashboard onDataUpload={handleDataUpload} onXmlContent={handleXmlContent} testData={testData} />;
    }
  };
  return <div className="app-shell min-h-screen bg-background text-foreground">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="container mx-auto px-4 py-8">
        {getActiveComponent()}
      </main>
      <Toaster richColors closeButton />
    </div>;
}
