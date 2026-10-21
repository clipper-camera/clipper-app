import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, TextInput, KeyboardAvoidingView, Platform, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { messageService, ReceivedMessage, SentMessage } from '../services/messageService';
import { uploadService } from '../services/uploadService';
import * as FileSystem from 'expo-file-system';
import { Swipeable } from 'react-native-gesture-handler';
import { FontAwesome6 } from '@expo/vector-icons';
import { settingsService } from '../services/settingsService';
import { format } from 'date-fns';
import { mediaCacheService } from '../services/mediaCacheService';
import { useTheme, themeColors } from '../theme/ThemeContext';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type ChatItem =
  | { kind: 'received'; id: string; timestamp: number; message: ReceivedMessage }
  | { kind: 'sent'; id: string; timestamp: number; message: SentMessage }
  | { kind: 'yearDivider'; id: string; timestamp: number; year: number };

const VIDEO_EXPIRY_MS = 10 * 60 * 1000;

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

type RootStackParamList = {
  ChatThread: { userId: string; displayName: string };
  Home: { recipientId?: string; recipientName?: string } | undefined;
  Preview: {
    mediaUri: string;
    mediaType: 'image' | 'video';
    canSend: boolean;
    textOverlays?: TextOverlay[];
  };
};

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

type ChatThreadScreenProps = NativeStackScreenProps<RootStackParamList, 'ChatThread'>;

export default function ChatThreadScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<ChatThreadScreenProps['navigation']>();
  const route = useRoute<ChatThreadScreenProps['route']>();
  const { userId, displayName } = route.params;
  const [items, setItems] = useState<ChatItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draftText, setDraftText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const swipeableRefs = useRef<{ [key: string]: Swipeable | null }>({});
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadingMessageId, setDownloadingMessageId] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<Record<string, { status: string; progress?: number }>>({});
  const itemsRef = useRef<ChatItem[]>([]);
  const [now, setNow] = useState(Date.now());
  const flatListRef = useRef<FlatList<ChatItem>>(null);
  // Bumped after every send to remount the TextInput. A plain setDraftText('')
  // can lose a race on some Android keyboards: typing fast and hitting send
  // right as the IME commits composing text can deliver a stale onChangeText
  // *after* our clear, silently repopulating the box. Remounting tears down
  // the native EditText entirely so there's no stale buffer left to race.
  const [inputKey, setInputKey] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // The list is rendered inverted (newest item at array index 0, list flipped
  // so index 0 sits at the bottom of the screen). That makes "the bottom" a
  // fixed scroll offset of 0 regardless of content height or viewport size —
  // no scrollToEnd()/onContentSizeChange timing races, no keyboard-resize
  // reflow invalidating it. Sorting stays ascending everywhere else (year
  // dividers etc.); only the FlatList's data is reversed.
  const reversedItems = useMemo(() => [...items].reverse(), [items]);

  const scrollToBottom = useCallback((animated = true) => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIsAtBottom(e.nativeEvent.contentOffset.y < 80);
  }, []);

  const refreshUploadStatus = useCallback((currentItems: ChatItem[]) => {
    const uploadIds = currentItems
      .filter((it): it is ChatItem & { kind: 'sent' } => it.kind === 'sent')
      .map(it => (it.message as SentMessage).uploadId)
      .filter((id): id is string => !!id);
    if (uploadIds.length === 0) return;
    const next: Record<string, { status: string; progress?: number }> = {};
    for (const id of uploadIds) {
      const s = uploadService.getStatus(id);
      if (s) next[id] = s;
    }
    setUploadStatus(next);
  }, []);

  const loadMessages = async (showSpinner = true) => {
    try {
      if (showSpinner) setIsLoading(true);
      await messageService.checkForNewMessages();
      const [received, sent] = await Promise.all([
        messageService.getMessagesForContact(userId),
        messageService.getSentMessagesForContact(userId),
      ]);

      // A text message arrives with its body already in hand, so opening the
      // thread is the read. Media still has to be tapped.
      for (const message of received) {
        if (message.mediaType === 'text' && !message.viewed) {
          await messageService.markAsViewed(message.id);
        }
      }
      const withoutDividers: ChatItem[] = [
        ...received.map((m): ChatItem => ({ kind: 'received', id: m.id, timestamp: m.timestamp, message: m })),
        ...sent.map((m): ChatItem => ({ kind: 'sent', id: m.id, timestamp: m.timestamp, message: m })),
      ].sort((a, b) => a.timestamp - b.timestamp || (a.kind === 'sent' ? 0 : 1) - (b.kind === 'sent' ? 0 : 1));

      const merged: ChatItem[] = [];
      let lastYear: number | null = null;
      for (const it of withoutDividers) {
        const year = new Date(it.timestamp).getFullYear();
        if (lastYear !== null && year !== lastYear) {
          merged.push({ kind: 'yearDivider', id: `year-${year}-${it.id}`, timestamp: it.timestamp, year });
        }
        merged.push(it);
        lastYear = year;
      }

      setItems(merged);
      itemsRef.current = merged;
      refreshUploadStatus(merged);
      // No explicit scroll needed: the list is inverted and rests at offset 0,
      // which is always "the bottom" regardless of content height. A thread
      // opens there by default, and new messages appear there for free as
      // long as the reader hasn't scrolled away (native scroll offset doesn't
      // shift on its own when content is added at the inverted start).
    } catch (error) {
      console.error('Error loading messages:', error);
      if (showSpinner) Alert.alert('Error', 'Failed to load messages. Please try again.');
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  };

  const handleSend = async () => {
    const text = draftText.trim();
    if (!text || isSending) return;
    setIsSending(true);
    try {
      const sent = await messageService.sendTextMessage(userId, text);
      setItems(prev => {
        const next = [...prev, { kind: 'sent' as const, id: sent.id, timestamp: sent.timestamp, message: sent }];
        itemsRef.current = next;
        return next;
      });
      setDraftText('');
      setInputKey(k => k + 1);
      scrollToBottom(true);
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message.');
    } finally {
      setIsSending(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadMessages();
      // Live upload progress for sent media bubbles, and a clock tick so
      // watched videos gray out once they cross the expiry window.
      const interval = setInterval(() => {
        refreshUploadStatus(itemsRef.current);
        setNow(Date.now());
      }, 1000);
      // The global poll runs on the settings interval, 15 minutes by default,
      // which is far too slow for an open conversation. Poll for incoming
      // messages and delivery receipts while the thread is on screen.
      const poll = setInterval(() => loadMessages(false), 5000);
      return () => {
        clearInterval(interval);
        clearInterval(poll);
      };
    }, [userId, refreshUploadStatus])
  );

  const handleMarkAsViewed = async (messageId: string) => {
    try {
      await messageService.markAsViewed(messageId);
      setItems(prev =>
        prev.map(it =>
          it.kind === 'received' && it.id === messageId
            ? { ...it, message: { ...it.message, viewed: true } }
            : it
        )
      );
    } catch (error) {
      console.error('Error marking message as viewed:', error);
    }
  };

  const handleDelete = async (messageId: string) => {
    try {
      await messageService.markAsViewed(messageId);
      await messageService.deleteMessage(messageId);
      setItems(prev => prev.filter(it => it.id !== messageId));
    } catch (error) {
      console.error('Error deleting message:', error);
      Alert.alert('Error', 'Failed to delete message.');
    }
  };

  const renderRightActions = (messageId: string) => (
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

  const downloadMediaToLocal = async (mediaUri: string) => {
    try {
      const settings = await settingsService.getSettings();
      const fullMediaUrl = `${settings.apiEndpoint}${mediaUri}`;

      const cache = mediaCacheService.getCache();
      const cachedEntry = Object.values(cache).find(entry => entry.uri.includes(mediaUri.split('/').pop()!));
      if (cachedEntry) {
        const fileInfo = await FileSystem.getInfoAsync(cachedEntry.uri);
        if (fileInfo.exists) {
          return cachedEntry.uri;
        }
      }

      const cacheKey = mediaCacheService.getCacheKey(fullMediaUrl);
      const destination = `${mediaCacheService.getCacheDir()}${cacheKey}`;

      const downloadResumable = FileSystem.createDownloadResumable(
        fullMediaUrl,
        destination,
        {},
        (progressEvent) => {
          setDownloadProgress(progressEvent.totalBytesWritten / progressEvent.totalBytesExpectedToWrite);
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

  const openMessage = async (item: ReceivedMessage) => {
    if (isDownloading || item.mediaType === 'text' || !item.mediaUrl) return;
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadingMessageId(item.id);
    try {
      handleMarkAsViewed(item.id);
      const savedUri = await downloadMediaToLocal(item.mediaUrl);
      if (savedUri) {
        navigation.navigate('Preview', {
          mediaUri: savedUri,
          mediaType: item.mediaType,
          canSend: false,
          textOverlays: item.textOverlays,
        });
      }
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
      setDownloadingMessageId(null);
    }
  };

  const renderMessage = ({ item }: { item: ChatItem }) => {
    if (item.kind === 'yearDivider') {
      return (
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: themeColors[theme].border }]} />
          <Text style={[styles.dividerText, { color: themeColors[theme].secondaryText }]}>{item.year}</Text>
          <View style={[styles.dividerLine, { backgroundColor: themeColors[theme].border }]} />
        </View>
      );
    }

    if (item.kind === 'sent') {
      const message = item.message;
      const upload = message.uploadId ? uploadStatus[message.uploadId] : undefined;
      const isFailed = upload?.status === 'failed';
      let mediaLabel = message.mediaType === 'video' ? 'Video' : 'Photo';
      if (upload?.status === 'pending') mediaLabel += ' · Sending…';
      else if (upload?.status === 'uploading') mediaLabel += ` · ${upload.progress ?? 0}%`;
      else if (isFailed) mediaLabel += ' · Failed';

      return (
        <View style={[styles.bubbleRow, styles.bubbleRowRight]}>
          <View style={[styles.bubble, styles.bubbleSent, { backgroundColor: themeColors[theme].primary }]}>
            {message.mediaType ? (
              <>
                <FontAwesome6
                  name={isFailed ? 'triangle-exclamation' : message.mediaType === 'video' ? 'play' : 'image'}
                  size={20}
                  color="white"
                />
                <Text style={[styles.bubbleLabel, styles.bubbleSentText]}>{mediaLabel}</Text>
                {upload?.status === 'uploading' && (
                  <View style={styles.progressBar}>
                    <View style={[styles.sentProgressFill, { width: `${(upload.progress ?? 0)}%` }]} />
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.bubbleSentText}>{message.text}</Text>
            )}
          </View>
          <Text style={[styles.bubbleTime, styles.bubbleTimeRight, { color: themeColors[theme].secondaryText }]}>
            {format(new Date(message.timestamp), 'MMM d, h:mm a')}
            {message.deliveredAt ? ' · Delivered' : message.messageId ? ' · Sent' : ''}
          </Text>
        </View>
      );
    }

    const message = item.message;
    const isText = message.mediaType === 'text';
    const isExpired = !isText && message.viewed && !!message.viewedAt && now - message.viewedAt > VIDEO_EXPIRY_MS;

    return (
      <Swipeable
        ref={ref => (swipeableRefs.current[message.id] = ref)}
        renderRightActions={() => renderRightActions(message.id)}
        rightThreshold={40}
      >
        <View style={styles.bubbleRow}>
          {isText ? (
            <View style={[styles.bubble, { backgroundColor: themeColors[theme].card }]}>
              <Text style={[styles.bubbleText, { color: themeColors[theme].text }]}>{message.text}</Text>
            </View>
          ) : (
          <TouchableOpacity
            style={[styles.bubble, { backgroundColor: themeColors[theme].card }]}
            disabled={isDownloading || isExpired}
            onPress={() => openMessage(message)}
          >
            <FontAwesome6
              name={message.mediaType === 'video' ? 'play' : 'image'}
              size={20}
              color={themeColors[theme].primary}
            />
            <Text style={[styles.bubbleLabel, { color: themeColors[theme].text }]}>
              {message.mediaType === 'video' ? 'Video' : 'Photo'}
              {downloadingMessageId === message.id
                ? ` · ${Math.round(downloadProgress * 100)}%`
                : isExpired
                ? ' · Expired'
                : !message.viewed && message.fileSize
                ? ` · ${formatSize(message.fileSize)}`
                : ''}
            </Text>
            {!message.viewed && <View style={styles.unviewedDot} />}
            {downloadingMessageId === message.id && (
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${downloadProgress * 100}%` }]} />
              </View>
            )}
          </TouchableOpacity>
          )}
          <Text style={[styles.bubbleTime, { color: themeColors[theme].secondaryText }]}>
            {format(new Date(message.timestamp), 'MMM d, h:mm a')}
          </Text>
        </View>
      </Swipeable>
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors[theme].background }]}>
        <Text style={[styles.loadingText, { color: themeColors[theme].text }]}>Loading...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeColors[theme].background }]}>
      <View style={[styles.header, { borderBottomColor: themeColors[theme].border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <FontAwesome6 name="arrow-left" size={22} color={themeColors[theme].text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: themeColors[theme].text }]}>{displayName}</Text>
        <View style={styles.headerRight} />
      </View>

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.listWrapper}>
          <FlatList
            ref={flatListRef}
            data={reversedItems}
            inverted
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            onScroll={handleScroll}
            scrollEventThrottle={100}
            ListEmptyComponent={
              // FlatList applies the inverted flip to ListEmptyComponent too,
              // so counter-flip it back to right-side-up.
              <View style={[styles.emptyContainer, { transform: [{ scaleY: -1 }] }]}>
                <Text style={[styles.emptyText, { color: themeColors[theme].secondaryText }]}>
                  No messages with {displayName} yet
                </Text>
              </View>
            }
          />
          {!isAtBottom && items.length > 0 && (
            <TouchableOpacity
              style={[styles.jumpButton, { backgroundColor: themeColors[theme].card, borderColor: themeColors[theme].border }]}
              onPress={() => scrollToBottom(true)}
            >
              <FontAwesome6 name="chevron-down" size={16} color={themeColors[theme].text} />
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.inputBar, { borderTopColor: themeColors[theme].border, backgroundColor: themeColors[theme].background }]}>
          <TouchableOpacity
            style={[styles.cameraButton, { backgroundColor: themeColors[theme].card }]}
            onPress={() => navigation.push('Home', { recipientId: userId, recipientName: displayName })}
          >
            <FontAwesome6 name="camera" size={18} color={themeColors[theme].primary} style={styles.inputIcon} />
          </TouchableOpacity>
          <TextInput
            key={inputKey}
            style={[styles.textInput, { color: themeColors[theme].text, backgroundColor: themeColors[theme].card }]}
            value={draftText}
            onChangeText={setDraftText}
            placeholder="Message..."
            placeholderTextColor={themeColors[theme].secondaryText}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, { backgroundColor: draftText.trim() ? themeColors[theme].primary : themeColors[theme].border }]}
            onPress={handleSend}
            disabled={!draftText.trim() || isSending}
          >
            <FontAwesome6 name="paper-plane" size={17} color="white" style={styles.sendIcon} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    padding: 8,
    width: 40,
  },
  headerRight: {
    width: 40,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  listWrapper: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    padding: 10,
  },
  jumpButton: {
    position: 'absolute',
    bottom: 10,
    right: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  bubbleRow: {
    alignItems: 'flex-start',
    marginBottom: 6,
    maxWidth: '78%',
  },
  bubbleRowRight: {
    alignItems: 'flex-end',
    alignSelf: 'flex-end',
  },
  bubbleSent: {
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 6,
  },
  bubbleSentText: {
    color: 'white',
    fontSize: 15.5,
    lineHeight: 20,
  },
  bubbleTimeRight: {
    marginRight: 2,
    marginLeft: 0,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  textInput: {
    flex: 1,
    borderRadius: 19,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginHorizontal: 8,
    minHeight: 38,
    maxHeight: 100,
    fontSize: 15.5,
  },
  cameraButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Icon fonts carry extra ascender/descender space that Android reserves as
  // font padding, which pushes the glyph off-centre inside a round button.
  inputIcon: {
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  sendIcon: {
    includeFontPadding: false,
    textAlignVertical: 'center',
    // paper-plane's visual mass sits left of its glyph box centre
    marginLeft: 2,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    overflow: 'hidden',
  },
  bubbleLabel: {
    marginLeft: 6,
    fontSize: 15.5,
  },
  bubbleText: {
    fontSize: 15.5,
    lineHeight: 20,
  },
  bubbleTime: {
    fontSize: 10.5,
    marginTop: 2,
    marginLeft: 2,
    opacity: 0.8,
  },
  unviewedDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'red',
    marginLeft: 6,
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
  sentProgressFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  deleteButton: {
    backgroundColor: '#ff3b30',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
    borderRadius: 16,
  },
  loadingText: {
    fontSize: 20,
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
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: '600',
    marginHorizontal: 8,
  },
});
