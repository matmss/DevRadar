import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import DevForm from './index';

const DEV = {
  _id: '64b7f0c2a1b2c3d4e5f60718',
  github_username: 'gaearon',
  techs: ['ReactJS', 'Redux'],
  location: { type: 'Point', coordinates: [-46.6333, -23.5505] },
};

/** A promise the test settles by hand, to observe the form while a request is in flight. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const value = (label) => screen.getByLabelText(label).value;
const button = (name) => screen.getByRole('button', { name });

describe('DevForm', () => {
  let getCurrentPosition;
  let confirmSpy;
  beforeEach(() => {
    getCurrentPosition = jest.fn((onSuccess) => onSuccess({ coords: { latitude: -22.9, longitude: -43.2 } }));
    Object.defineProperty(global.navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });
  afterEach(() => confirmSpy.mockRestore());

  describe('without a profile (registration)', () => {
    it('says "Salvar", has no delete, and fills the location from the browser', () => {
      render(<DevForm onSubmit={jest.fn()} onDelete={jest.fn()} />);
      expect(button('Salvar')).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Excluir meu perfil' })).toBeNull();
      expect(value('Tecnologias')).toBe('');
      expect(value('Latitude')).toBe('-22.9');
      expect(value('Longitude')).toBe('-43.2');
    });

    it('keeps a draft with coordinates instead of asking the browser', () => {
      render(<DevForm draft={{ techs: 'Go', latitude: 1e-7, longitude: '-46.6' }} onSubmit={jest.fn()} onDelete={jest.fn()} />);
      expect(button('Salvar')).toBeEnabled();
      expect(value('Tecnologias')).toBe('Go');
      expect(value('Latitude')).toBe('0.0000001');
      expect(value('Longitude')).toBe('-46.6');
      expect(getCurrentPosition).not.toHaveBeenCalled();
    });
  });

  describe('with a profile (US-6 "Already registered")', () => {
    it('is prefilled with the saved techs and location and says "Atualizar"', () => {
      render(<DevForm dev={DEV} onSubmit={jest.fn()} onDelete={jest.fn()} />);
      expect(button('Atualizar')).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
      expect(value('Tecnologias')).toBe('ReactJS, Redux');
      expect(value('Latitude')).toBe('-23.5505');
      expect(value('Longitude')).toBe('-46.6333');
      // The saved location is kept, not replaced by the browser's position.
      expect(getCurrentPosition).not.toHaveBeenCalled();
    });

    // QA-AUTH5-2: String(1e-7) is "1e-7", which the backend rejects.
    it('prefills tiny and negative coordinates as plain decimals the backend accepts', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      const tiny = { ...DEV, location: { type: 'Point', coordinates: [-2.5e-8, 1e-7] } };
      render(<DevForm dev={tiny} onSubmit={onSubmit} onDelete={jest.fn()} />);
      expect(value('Latitude')).toBe('0.0000001');
      expect(value('Longitude')).toBe('-0.000000025');
      await act(async () => { fireEvent.click(button('Atualizar')); });
      expect(onSubmit).toHaveBeenCalledWith({ techs: 'ReactJS, Redux', latitude: '0.0000001', longitude: '-0.000000025' });
    });

    it('shows a draft (the user\'s input) instead of the saved values', () => {
      render(<DevForm dev={DEV} draft={{ techs: 'Go', latitude: '1.5', longitude: '-2' }} onSubmit={jest.fn()} onDelete={jest.fn()} />);
      expect(button('Atualizar')).toBeEnabled();
      expect(value('Tecnologias')).toBe('Go');
      expect(value('Latitude')).toBe('1.5');
      expect(value('Longitude')).toBe('-2');
    });

    it('submits the edited values', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      render(<DevForm dev={DEV} onSubmit={onSubmit} onDelete={jest.fn()} />);
      fireEvent.change(screen.getByLabelText('Tecnologias'), { target: { value: 'Elixir' } });
      await act(async () => { fireEvent.click(button('Atualizar')); });
      expect(onSubmit).toHaveBeenCalledWith({ techs: 'Elixir', latitude: '-23.5505', longitude: '-46.6333' });
    });

    it('asks for an in-page confirmation before deleting, never window.confirm', async () => {
      const onDelete = jest.fn().mockResolvedValue(undefined);
      render(<DevForm dev={DEV} onSubmit={jest.fn()} onDelete={onDelete} />);
      fireEvent.click(button('Excluir meu perfil'));
      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.getByRole('group')).toHaveTextContent('Excluir seu perfil do DevRadar?');

      await act(async () => { fireEvent.click(button('Confirmar exclusão')); });
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('cancelling the confirmation deletes nothing', () => {
      const onDelete = jest.fn();
      render(<DevForm dev={DEV} onSubmit={jest.fn()} onDelete={onDelete} />);
      fireEvent.click(button('Excluir meu perfil'));
      fireEvent.click(button('Cancelar'));
      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.queryByRole('group')).toBeNull();
      expect(button('Excluir meu perfil')).toBeEnabled();
    });

    it('disables every button while an update is in flight and sends it once', async () => {
      const request = deferred();
      const onSubmit = jest.fn(() => request.promise);
      render(<DevForm dev={DEV} onSubmit={onSubmit} onDelete={jest.fn()} />);
      await act(async () => {
        fireEvent.click(button('Atualizar'));
        fireEvent.click(button('Atualizar'));
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(button('Atualizar')).toBeDisabled();
      expect(button('Excluir meu perfil')).toBeDisabled();
      await act(async () => { request.resolve(); });
      expect(button('Atualizar')).toBeEnabled();
    });

    it('disables every button while a delete is in flight and sends it once', async () => {
      const request = deferred();
      const onDelete = jest.fn(() => request.promise);
      render(<DevForm dev={DEV} onSubmit={jest.fn()} onDelete={onDelete} />);
      fireEvent.click(button('Excluir meu perfil'));
      await act(async () => {
        fireEvent.click(button('Confirmar exclusão'));
        fireEvent.click(button('Confirmar exclusão'));
      });
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(button('Confirmar exclusão')).toBeDisabled();
      expect(button('Cancelar')).toBeDisabled();
      expect(button('Atualizar')).toBeDisabled();
      await act(async () => { request.resolve(); });
    });

    it('keeps the input and closes the confirmation when the delete fails', async () => {
      const onDelete = jest.fn().mockRejectedValue(new Error('server down'));
      render(<DevForm dev={DEV} onSubmit={jest.fn()} onDelete={onDelete} />);
      fireEvent.change(screen.getByLabelText('Tecnologias'), { target: { value: 'Go' } });
      fireEvent.click(button('Excluir meu perfil'));
      await act(async () => { fireEvent.click(button('Confirmar exclusão')); });
      expect(screen.queryByRole('group')).toBeNull();
      expect(value('Tecnologias')).toBe('Go');
      expect(button('Atualizar')).toBeEnabled();
    });
  });
});
