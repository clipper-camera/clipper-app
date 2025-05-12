import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, SafeAreaView, RefreshControl } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { uploadService } from '../services/uploadService';
import { contactsService, Contact } from '../services/contactsService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, themeColors } from '../theme/ThemeContext';

type RootStackParamList = {
  Home: undefined;
  Preview: { mediaUri: string; mediaType: 'image' | 'video', canSend: boolean };
  Contacts: { mediaUri: string; mediaType: 'image' | 'video', textOverlays?: TextOverlay[] };
};

type ContactsScreenProps = NativeStackScreenProps<RootStackParamList, 'Contacts'>;

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

const CONTACTS_KEY = '@selected_contacts';

export default function ContactsScreen() {
  const navigation = useNavigation<ContactsScreenProps['navigation']>();
  const route = useRoute<ContactsScreenProps['route']>();
  const { mediaUri, mediaType, textOverlays } = route.params;
  const { theme } = useTheme();
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadSelectedContacts();
    loadContacts();
  }, []);

  const loadSelectedContacts = async () => {
    try {
      const storedContacts = await AsyncStorage.getItem(CONTACTS_KEY);
      if (storedContacts) {
        setSelectedContacts(JSON.parse(storedContacts));
      }
    } catch (error) {
      console.error('Error loading selected contacts:', error);
    }
  };

  const loadContacts = async () => {
    try {
      setIsLoading(true);
      const loadedContacts = await contactsService.getContacts();
      setContacts(loadedContacts);
    } catch (error) {
      console.error('Error loading contacts:', error);
      Alert.alert('Error', 'Failed to load contacts. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleContact = async (contactId: string) => {
    try {
      const newSelectedContacts = selectedContacts.includes(contactId)
        ? selectedContacts.filter(id => id !== contactId)
        : [...selectedContacts, contactId];

      setSelectedContacts(newSelectedContacts);
      await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(newSelectedContacts));
    } catch (error) {
      console.error('Error toggling contact:', error);
      Alert.alert('Error', 'Failed to save contact selection. Please try again.');
    }
  };

  const handleShare = async () => {
    if (selectedContacts.length === 0) {
      Alert.alert('Error', 'Please select at least one contact');
      return;
    }

    setIsUploading(true);
    try {
      await uploadService.addToQueue(mediaUri, mediaType, selectedContacts, textOverlays);
      navigation.popToTop();
    } catch (error) {
      console.error('Error queueing upload:', error);
      Alert.alert('Error', 'Failed to queue upload. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    try {
      await contactsService.fetchContacts();
      const loadedContacts = await contactsService.getContacts();
      setContacts(loadedContacts);
    } catch (error) {
      console.error('Error refreshing contacts:', error);
      Alert.alert('Error', 'Failed to refresh contacts. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const renderContact = ({ item }: { item: Contact }) => (
    <TouchableOpacity
      style={[
        styles.contactItem,
        { 
          borderColor: themeColors[theme].border,
        }
      ]}
      onPress={() => toggleContact(item.id)}
    >
      <View style={styles.contactInfo}>
        <Text style={[styles.contactName, { color: themeColors[theme].text }]}>
          {item.display_name}
        </Text>
      </View>
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: selectedContacts.includes(item.id)
              ? themeColors[theme].primary
              : 'transparent',
            borderColor: themeColors[theme].border,
          },
        ]}
      />
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors[theme].background }]}>
        <Text style={[styles.loadingText, { color: themeColors[theme].text }]}>Loading contacts...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeColors[theme].background }]}>
      <View style={[styles.header, { borderBottomColor: themeColors[theme].border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <FontAwesome6 name="arrow-left" size={24} color={themeColors[theme].text} />
        </TouchableOpacity>
        <Text style={[styles.headerText, { color: themeColors[theme].text }]}>Contacts</Text>
        <View style={styles.headerRight} />
      </View>

      <FlatList
        data={contacts}
        renderItem={renderContact}
        keyExtractor={item => item.id}
        style={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={themeColors[theme].text}
            colors={[themeColors[theme].primary]}
          />
        }
      />

      <View style={[styles.footer, { backgroundColor: themeColors[theme].card, borderTopColor: themeColors[theme].border }]}>
        <TouchableOpacity 
          onPress={handleShare} 
          style={[
            styles.sendButton,
            { backgroundColor: selectedContacts.length ? themeColors[theme].primary : themeColors[theme].border }
          ]}
          disabled={!selectedContacts.length || isUploading}
        >
          <FontAwesome6 name="paper-plane" size={24} color={themeColors[theme].text} />
          <Text style={[styles.sendButtonText, { color: themeColors[theme].text }]}>
            {isUploading ? 'Sending...' : 'Send'}
          </Text>
        </TouchableOpacity>
      </View>
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
  },
  headerText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerRight: {
    width: 40,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  list: {
    flex: 1,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 0,
    borderWidth: 1,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 18,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
  },
  sendButtonText: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  loadingText: {
    fontSize: 16,
    textAlign: 'center',
  },
}); 