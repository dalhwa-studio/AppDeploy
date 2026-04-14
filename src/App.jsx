import React, { useState } from 'react';
import { AppProvider, useApp } from './hooks/useAppContext';
import Sidebar from './components/layout/Sidebar';
import AppList from './components/apps/AppList';
import SharedMetaTab from './components/detail/SharedMetaTab';
import GooglePlayTab from './components/detail/GooglePlayTab';
import AppStoreTab from './components/detail/AppStoreTab';
import BuildReleaseTab from './components/detail/BuildReleaseTab';
import ToastContainer from './components/common/Toast';
import './index.css';

const TAB_COMPONENTS = {
  shared: SharedMetaTab,
  google: GooglePlayTab,
  apple: AppStoreTab,
  build: BuildReleaseTab,
};

const TAB_TITLES = {
  shared: '공통 정보',
  google: 'Google Play',
  apple: 'App Store',
  build: 'Build & Release',
};

function AppRouter() {
  const { currentAppId } = useApp();
  const [activeTab, setActiveTab] = useState('shared');

  const ActiveComponent = TAB_COMPONENTS[activeTab] || SharedMetaTab;

  return (
    <div className="app-layout">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="main-area">
        {currentAppId ? (
          <>
            <div className="page-header">
              <h2>{TAB_TITLES[activeTab]}</h2>
            </div>
            <div className="page-content">
              <ActiveComponent key={activeTab} />
            </div>
          </>
        ) : (
          <AppList />
        )}
      </div>

      <ToastContainer />
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  );
}

export default App;
