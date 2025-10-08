// frontend/components/Dashboard.tsx
"use client";
import React, { useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '../contexts/AuthContext';
import Board from './Board';
import axios from 'axios';

type Team = {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
  createdAt: number;
};

type BoardType = {
  id: string;
  name: string;
  teamId: string | null;
  ownerId: string;
  isPersonal: boolean;
  createdAt: number;
};

type User = {
  id: string;
  email: string;
  name: string;
};

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

api.interceptors.request.use((config: any) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const fetcher = (url: string) => api.get(url).then(r => r.data);

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  
  // New states for invite functionality
  const [inviteEmail, setInviteEmail] = useState('');
  const [showInviteModal, setShowInviteModal] = useState<string | null>(null);
  const [showMembersModal, setShowMembersModal] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const { data: teams, mutate: mutateTeams } = useSWR<Team[]>('/teams', fetcher);
  const { data: boards, mutate: mutateBoards } = useSWR<BoardType[]>('/boards', fetcher);
  const { data: allUsers } = useSWR<User[]>('/users', fetcher);

  const createBoard = async () => {
    await api.post('/boards', {
      name: newBoardName,
      teamId: selectedTeam,
      isPersonal: !selectedTeam
    });
    setNewBoardName('');
    setShowCreateBoard(false);
    setSelectedTeam(null);
    mutateBoards();
  };

  const createTeam = async () => {
    await api.post('/teams', { name: newTeamName });
    setNewTeamName('');
    setShowCreateTeam(false);
    mutateTeams();
  };

  const inviteToTeam = async (teamId: string, email: string) => {
    setInviteLoading(true);
    setInviteError('');
    try {
      await api.post(`/teams/${teamId}/invite`, { email });
      setInviteEmail('');
      setShowInviteModal(null);
      mutateTeams(); // Refresh teams to show updated members
    } catch (err: any) {
      setInviteError(err.response?.data?.error || 'Failed to invite user');
    } finally {
      setInviteLoading(false);
    }
  };

  // Add the onBack function
  const handleBackFromBoard = () => {
    setSelectedBoard(null);
  };

  // Get user info for member list
  const getMemberInfo = (memberId: string) => {
    return allUsers?.find(u => u.id === memberId) || { id: memberId, name: 'Unknown User', email: '' };
  };

  // Get team name for a board
  const getTeamNameForBoard = (board: BoardType) => {
    if (board.isPersonal || !board.teamId) return null;
    return teams?.find(team => team.id === board.teamId)?.name || 'Unknown Team';
  };

  if (selectedBoard) {
    return <Board boardId={selectedBoard} onBack={handleBackFromBoard} />;
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Your Boards</h1>
        <div className="flex gap-4 items-center">
          <span>Welcome, {user?.name}</span>
          <button onClick={logout} className="px-4 py-2 bg-red-600 text-white rounded">
            Logout
          </button>
        </div>
      </div>

      {/* Teams Section */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Teams</h2>
          <button 
            onClick={() => setShowCreateTeam(true)}
            className="px-4 py-2 bg-green-600 text-white rounded"
          >
            Create Team
          </button>
        </div>
        
        {showCreateTeam && (
          <div className="mb-4 p-4 border rounded">
            <input
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Team name"
              className="px-3 py-2 border rounded mr-2"
            />
            <button onClick={createTeam} className="px-4 py-2 bg-blue-600 text-white rounded mr-2">
              Create
            </button>
            <button onClick={() => setShowCreateTeam(false)} className="px-4 py-2 bg-gray-600 text-white rounded">
              Cancel
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {teams?.map(team => (
            <div key={team.id} className="p-4 border rounded bg-white shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-semibold text-lg text-black">{team.name}</h3>
                {team.ownerId === user?.id && (
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Owner
                  </span>
                )}
              </div>
              
              <p className="text-sm text-gray-600 mb-3">
                {team.members.length} member{team.members.length !== 1 ? 's' : ''}
              </p>
              
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => {
                    setSelectedTeam(team.id);
                    setShowCreateBoard(true);
                  }}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                >
                  Create Board
                </button>
                
                {team.ownerId === user?.id && (
                  <>
                    <button 
                      onClick={() => setShowInviteModal(team.id)}
                      className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                    >
                      Invite
                    </button>
                    
                    <button 
                      onClick={() => setShowMembersModal(team.id)}
                      className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                    >
                      Members
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 text-black">
              Invite to {teams?.find(t => t.id === showInviteModal)?.name}
            </h3>
            
            {inviteError && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                {inviteError}
              </div>
            )}
            
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Enter email address"
              className="w-full px-3 py-2 border rounded mb-4 text-black"
            />
            
            <div className="flex gap-2 justify-end">
              <button 
                onClick={() => {
                  setShowInviteModal(null);
                  setInviteEmail('');
                  setInviteError('');
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded"
              >
                Cancel
              </button>
              <button 
                onClick={() => inviteToTeam(showInviteModal, inviteEmail)}
                disabled={!inviteEmail || inviteLoading}
                className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
              >
                {inviteLoading ? 'Inviting...' : 'Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members Modal */}
      {showMembersModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 text-black">
              Team Members - {teams?.find(t => t.id === showMembersModal)?.name}
            </h3>
            
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {teams?.find(t => t.id === showMembersModal)?.members.map(memberId => {
                const member = getMemberInfo(memberId);
                return (
                  <div key={memberId} className="flex justify-between items-center p-2 border rounded">
                    <div>
                      <div className="font-medium">{member.name}</div>
                      <div className="text-sm text-gray-600">{member.email}</div>
                    </div>
                    {memberId === teams?.find(t => t.id === showMembersModal)?.ownerId && (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        Owner
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            
            <div className="flex justify-end mt-4">
              <button 
                onClick={() => setShowMembersModal(null)}
                className="px-4 py-2 bg-gray-600 text-white rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Boards Section */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Boards</h2>
          <button 
            onClick={() => {
              setSelectedTeam(null);
              setShowCreateBoard(true);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            Create Board
          </button>
        </div>

        {showCreateBoard && (
          <div className="mb-4 p-4 border rounded">
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">
                Board Type: {selectedTeam ? 'Team Board' : 'Personal Board'}
              </label>
              {selectedTeam && (
                <p className="text-sm text-gray-600">
                  Creating for team: {teams?.find(t => t.id === selectedTeam)?.name}
                </p>
              )}
            </div>
            <input
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              placeholder="Board name"
              className="w-full px-3 py-2 border rounded mb-2"
            />
            <div className="flex gap-2">
              <button 
                onClick={createBoard} 
                className="px-4 py-2 bg-blue-600 text-white rounded"
                disabled={!newBoardName.trim()}
              >
                Create
              </button>
              <button 
                onClick={() => {
                  setShowCreateBoard(false);
                  setSelectedTeam(null);
                  setNewBoardName('');
                }} 
                className="px-4 py-2 bg-gray-600 text-white rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {boards?.map(board => {
            const teamName = getTeamNameForBoard(board);
            
            return (
              <div 
                key={board.id} 
                onClick={() => setSelectedBoard(board.id)}
                className="p-4 border rounded cursor-pointer hover:bg-gray-50 transition-colors bg-white shadow-sm"
              >
                <h3 className="font-semibold text-lg mb-2 text-black">{board.name}</h3>
                <p className="text-sm text-gray-600 mb-1">
                  {board.isPersonal ? 'Personal Board' : teamName ? `${teamName} Team` : 'Team Board'}
                </p>
                <div className="text-xs text-gray-500">
                  Created: {new Date(board.createdAt).toLocaleDateString()}
                </div>
              </div>
            );
          })}
        </div>

        {boards?.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No boards yet. Create your first board to get started!
          </div>
        )}
      </div>
    </div>
  );
}