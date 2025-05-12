import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl, SafeAreaView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { messageService, ReceivedMessage } from '../services/messageService';
import * as FileSystem from 'expo-file-system';
import { Swipeable } from 'react-native-gesture-handler';
import { FontAwesome6 } from '@expo/vector-icons';
import { settingsService } from '../services/settingsService';
import { format, formatDistanceToNow } from 'date-fns';
import { mediaCacheService } from '../services/mediaCacheService';
import { useTheme, themeColors } from '../theme/ThemeContext';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type RootStackParamList = {
  ReceivedMessages: undefined;
  Home: undefined;
  Preview: { 
    mediaUri: string; 
    mediaType: 'image' | 'video'; 
    canSend: boolean;
    textOverlays?: TextOverlay[];
  };
};

type ReceivedMessagesScreenProps = NativeStackScreenProps<RootStackParamList, 'ReceivedMessages'>;

interface TextOverlay {
  id: string;
  text: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  scale: number;
  color: string;
  fontSize: number;
  fontFamily: string;
}

export default function ReceivedMessagesScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<ReceivedMessagesScreenProps['navigation']>();
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const swipeableRefs = useRef<{ [key: string]: Swipeable | null }>({});
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadingMessageId, setDownloadingMessageId] = useState<string | null>(null);

  useEffect(() => {
    loadMessages();
  }, []);

  const loadMessages = async () => {
    try {
      setIsLoading(true);
      // First check for new messages
      await messageService.checkForNewMessages();
      // Then get all messages
      const allMessages = await messageService.getMessages();
      setMessages(allMessages);
    } catch (error) {
      console.error('Error loading messages:', error);
      Alert.alert('Error', 'Failed to load messages. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadMessages();
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Load messages when screen is focused
  useFocusEffect(
    useCallback(() => {
      loadMessages();
    }, [])
  );

  const handleMarkAsViewed = async (messageId: string) => {
    try {
      await messageService.markAsViewed(messageId);
      setMessages(prevMessages => 
        prevMessages.map(msg => 
          msg.id === messageId ? { ...msg, viewed: true } : msg
        )
      );
    } catch (error) {
      console.error('Error marking message as viewed:', error);
      Alert.alert('Error', 'Failed to mark message as viewed.');
    }
  };

  const handleDelete = async (messageId: string) => {
    try {
      // Mark the message as viewed before deleting
      await messageService.markAsViewed(messageId);
      
      // Now delete the message
      await messageService.deleteMessage(messageId);
      
      // Update the state to remove the message from the list
      setMessages(prevMessages => prevMessages.filter(msg => msg.id !== messageId));
    } catch (error) {
      console.error('Error deleting message:', error);
      Alert.alert('Error', 'Failed to delete message.');
    }
  };

  const renderRightActions = (messageId: string) => {
    return (
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => {
          swipeableRefs.current[messageId]?.close();
          handleDelete(messageId);
        }}
      >
        <FontAwesome6 name="trash" size={24} color="white" />
      </TouchableOpacity>
    );
  };
  
  const downloadMediaToLocal = async (mediaUri: string, mediaType: 'image' | 'video') => {
    try {
      const settings = await settingsService.getSettings();
      const fullMediaUrl = `${settings.apiEndpoint}${mediaUri}`;
      
      // Check if we have a cached version first
      const cache = mediaCacheService.getCache();
      const cachedEntry = Object.values(cache).find(entry => 
        entry.uri.includes(mediaUri.split('/').pop()!)
      );

      if (cachedEntry) {
        const fileInfo = await FileSystem.getInfoAsync(cachedEntry.uri);
        if (fileInfo.exists) {
          return cachedEntry.uri;
        }
      }

      // If no valid cache, download with progress tracking
      const cacheKey = mediaCacheService.getCacheKey(fullMediaUrl);
      const destination = `${mediaCacheService.getCacheDir()}${cacheKey}`;

      const downloadResumable = FileSystem.createDownloadResumable(
        fullMediaUrl,
        destination,
        {},
        (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          setDownloadProgress(progress);
        }
      );

      const result = await downloadResumable.downloadAsync();
      if (result?.uri) {
        mediaCacheService.addToCache(cacheKey, result.uri);
        return result.uri;
      }
      return null;
    } catch (error) {
      console.error('Error downloading media:', error);
      return null;
    }
  };

  const renderMessage = ({ item }: { item: ReceivedMessage }) => (
    <Swipeable
      ref={ref => swipeableRefs.current[item.id] = ref}
      renderRightActions={() => renderRightActions(item.id)}
      rightThreshold={40}
    >
      <TouchableOpacity 
        style={[
          styles.messageItem,
          { 
            backgroundColor: themeColors[theme].background,
            borderColor: themeColors[theme].border,
          }
        ]}
        disabled={isDownloading}
        onPress={async () => {
          if (isDownloading) return;
          setIsDownloading(true);
          setDownloadProgress(0);
          setDownloadingMessageId(item.id);
          try {
            handleMarkAsViewed(item.id);
            const savedUri = await downloadMediaToLocal(item.mediaUrl, item.mediaType);
            if (savedUri) {
              navigation.navigate('Preview', { 
                mediaUri: savedUri, 
                mediaType: item.mediaType, 
                canSend: false,
                textOverlays: item.textOverlays 
              });
            }
          } finally {
            setIsDownloading(false);
            setDownloadProgress(0);
            setDownloadingMessageId(null);
          }
        }}>
        <View style={styles.messageContent}>
          <Text style={[styles.senderText, { color: theme === 'dark' ? 'white' : themeColors[theme].text }]}>From: {item.displayName}</Text>
          <Text style={[styles.timestamp, { color: theme === 'dark' ? 'white' : themeColors[theme].secondaryText }]}>
            {format(new Date(item.timestamp), 'MMM d, yyyy h:mm a')}
            {' • '}
            {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
          </Text>
        </View>
        {!item.viewed && (
          <View style={styles.unviewedIndicator} />
        )}
        {downloadingMessageId === item.id && (
          <View style={styles.progressBar}>
            <View 
              style={[
                styles.progressFill,
                { width: `${downloadProgress * 100}%` }
              ]} 
            />
          </View>
        )}
      </TouchableOpacity>
    </Swipeable>
  );

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors[theme].background }]}>
        <Text style={[styles.loadingText, { color: themeColors[theme].text }]}>Loading messages...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeColors[theme].background }]}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <FontAwesome6 name="arrow-left" size={24} color={themeColors[theme].text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: themeColors[theme].text }]}>Received Messages</Text>
        <View style={styles.headerRight} />
      </View>

      <FlatList
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="white"
            titleColor="white"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: themeColors[theme].secondaryText }]}>No messages received yet</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  backButton: {
    padding: 8,
  },
  headerRight: {
    width: 40, // Same width as backButton for balance
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  listContent: {
    flexGrow: 1,
  },
  messageItem: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    overflow: 'hidden',
  },
  messageContent: {
    flex: 1,
  },
  senderText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  timestamp: {
    fontSize: 14,
  },
  unviewedIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'red',
  },
  deleteButton: {
    backgroundColor: '#ff3b30',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    width: '100%',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 122, 255, 0.4)',
  },
  loadingText: {
    fontSize: 40,
    marginTop: 100,
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
  },
}); 