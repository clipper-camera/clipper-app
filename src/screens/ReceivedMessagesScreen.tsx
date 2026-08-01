import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { messageService, ReceivedMessage } from '../services/messageService';
import { contactsService, Contact } from '../services/contactsService';
import { FontAwesome6 } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { useTheme, themeColors } from '../theme/ThemeContext';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type RootStackParamList = {
  ReceivedMessages: undefined;
  ChatThread: { userId: string; displayName: string };
  Home: undefined;
};

type ReceivedMessagesScreenProps = NativeStackScreenProps<RootStackParamList, 'ReceivedMessages'>;

interface Conversation {
  userId: string;
  displayName: string;
  lastMessage?: ReceivedMessage;
  unreadCount: number;
}

export default function ReceivedMessagesScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<ReceivedMessagesScreenProps['navigation']>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadConversations = async () => {
    try {
      setIsLoading(true);
      await messageService.checkForNewMessages();
      const [contacts, messages] = await Promise.all([
        contactsService.getContacts(),
        messageService.getMessages(), // newest first
      ]);

      const byContact = new Map<string, Conversation>();
      for (const c of contacts) {
        byContact.set(c.id, { userId: c.id, displayName: c.display_name, unreadCount: 0 });
      }
      for (const m of messages) {
        const entry = byContact.get(m.userId) ?? { userId: m.userId, displayName: m.displayName, unreadCount: 0 };
        if (!entry.lastMessage) entry.lastMessage = m; // messages sorted newest-first
        if (!m.viewed) entry.unreadCount += 1;
        byContact.set(m.userId, entry);
      }

      const sorted = Array.from(byContact.values()).sort(
        (a, b) => (b.lastMessage?.timestamp ?? 0) - (a.lastMessage?.timestamp ?? 0)
      );
      setConversations(sorted);
    } catch (error) {
      console.error('Error loading conversations:', error);
      Alert.alert('Error', 'Failed to load conversations. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadConversations();
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [])
  );

  const renderPreview = (item: Conversation) => {
    if (!item.lastMessage) return 'No messages yet';
    if (item.lastMessage.mediaType === 'text') return item.lastMessage.text ?? '';
    const icon = item.lastMessage.mediaType === 'video' ? '🎥' : '📷';
    return `${icon} ${item.lastMessage.mediaType === 'video' ? 'Video' : 'Photo'}`;
  };

  const renderConversation = ({ item }: { item: Conversation }) => (
    <TouchableOpacity
      style={[
        styles.row,
        { borderColor: themeColors[theme].border },
      ]}
      onPress={() => navigation.navigate('ChatThread', { userId: item.userId, displayName: item.displayName })}
    >
      <View style={styles.rowContent}>
        <Text style={[styles.name, { color: themeColors[theme].text }]}>{item.displayName}</Text>
        <Text style={[styles.preview, { color: themeColors[theme].secondaryText }]} numberOfLines={1}>
          {renderPreview(item)}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {item.lastMessage && (
          <Text style={[styles.timestamp, { color: themeColors[theme].secondaryText }]}>
            {formatDistanceToNow(new Date(item.lastMessage.timestamp), { addSuffix: true })}
          </Text>
        )}
        {item.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

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
        <Text style={[styles.title, { color: themeColors[theme].text }]}>Messages</Text>
        <View style={styles.headerRight} />
      </View>

      <FlatList
        data={conversations}
        renderItem={renderConversation}
        keyExtractor={(item) => item.userId}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColors[theme].text} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: themeColors[theme].secondaryText }]}>
              No contacts yet. Add contacts to start chatting.
            </Text>
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
    fontSize: 24,
    fontWeight: 'bold',
  },
  listContent: {
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowContent: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  preview: {
    fontSize: 14,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  timestamp: {
    fontSize: 12,
    marginBottom: 6,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ff3b30',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  unreadBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
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
});
