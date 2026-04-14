import React, { useState } from 'react';
import { useApp } from '../../hooks/useAppContext';
import SharedMetaTab from './SharedMetaTab';
import GooglePlayTab from './GooglePlayTab';
import AppStoreTab from './AppStoreTab';
import BuildReleaseTab from './BuildReleaseTab';

export default function AppDetail() {
  const { currentApp } = useApp();
  const [activeTab, setActiveTab] = useState('shared');

  if (!currentApp) return null;

  const TAB_COMPONENTS = {
    shared: SharedMetaTab,
    google: GooglePlayTab,
    apple: AppStoreTab,
    build: BuildReleaseTab,
  };

  const ActiveComponent = TAB_COMPONENTS[activeTab] || SharedMetaTab;

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div className="detail-header">
          <h2>
            {{
              shared: '공통 정보',
              google: 'Google Play',
              apple: 'App Store',
              build: 'Build & Release',
            }[activeTab]}
          </h2>
        </div>
      </div>

      {/* Content */}
      <div className="page-content">
        <ActiveComponent />
      </div>
    </>
  );
}

// Export the tab control hook for Sidebar to use
export function useDetailTab() {
  const [activeTab, setActiveTab] = useState('shared');
  return { activeTab, setActiveTab };
}
