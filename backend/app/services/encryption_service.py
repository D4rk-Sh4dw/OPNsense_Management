import logging
from cryptography.fernet import Fernet
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class EncryptionService:
    """Service for encrypting/decrypting sensitive data"""

    @staticmethod
    def _get_cipher():
        """Get Fernet cipher instance"""
        # Use SECRET_KEY padded/hashed to create proper key
        # In production, use a dedicated encryption key from secure storage
        key_material = settings.SECRET_KEY.encode()
        # Fernet requires 32 bytes base64 encoded
        import hashlib
        import base64
        key = base64.urlsafe_b64encode(hashlib.sha256(key_material).digest())
        return Fernet(key)

    @staticmethod
    def encrypt(plaintext: str) -> bytes:
        """
        Encrypt a string

        Args:
            plaintext: String to encrypt

        Returns:
            Encrypted bytes
        """
        try:
            cipher = EncryptionService._get_cipher()
            return cipher.encrypt(plaintext.encode())
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            raise

    @staticmethod
    def decrypt(ciphertext: bytes) -> str:
        """
        Decrypt bytes to string

        Args:
            ciphertext: Encrypted bytes

        Returns:
            Decrypted string
        """
        try:
            cipher = EncryptionService._get_cipher()
            return cipher.decrypt(ciphertext).decode()
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            raise
