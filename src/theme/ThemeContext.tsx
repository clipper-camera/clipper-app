import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [theme, setTheme] = useState<Theme>(systemColorScheme || 'light');

  useEffect(() => {
    setTheme(systemColorScheme || 'light');
  }, [systemColorScheme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const themeColors = {
  light: {
    background: '#FFFFFF',
    text: '#000000',
    secondaryText: '#666666',
    primary: '#007AFF',
    secondary: '#5856D6',
    border: '#E5E5EA',
    card: '#F2F2F7',
    error: '#FF3B30',
    warning: '#FF9500',
  },
  dark: {
    background: '#000000',
    text: '#FFFFFF',
    secondaryText: '#999999',
    primary: '#0A84FF',
    secondary: '#5E5CE6',
    border: '#38383A',
    card: '#1C1C1E',
    error: '#FF453A',
    warning: '#FF9F0A',
  },
}; 