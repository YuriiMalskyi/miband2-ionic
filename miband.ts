import {BLE} from '@ionic-native/ble/ngx';
import * as AES from 'aes-js';
import {BufferService} from '../services/buffer-service/buffer.service';
import {ToasterService} from '../services/toaster-service/toaster.service';
import {interval} from 'rxjs';

const UUID_BASE = (x) => `0000${x}-0000-3512-2118-0009af100700`;

const UUID_SERVICE_HEART_RATE = '180d';
const UUID_HEART_RATE_CONTROL = '2a39';

const UUID_SERVICE_NOTIFICATION = '1802';
const UUID_NOTIFICATION_CONTROL = '2a06';

const UUID_SERVICE_MIBAND_2 = 'fee1';
const UUID_AUTH_SERVICE = UUID_BASE('0009');
const UUID_HEART_RATE_LISTENER = '2a37';

export class MiBand {

  char;
  private encryptionKey: number[] = [0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45];
  private hrmTimer;

  constructor(private ble: BLE,
              private device: any,
              private bufferService: BufferService,
              private toasterService: ToasterService) {
    this.char = {} as any;
  }

  static get optionalServices() {
    return [
      UUID_SERVICE_HEART_RATE
    ];
  }

  async init() {
    console.log('Starting connection process to MiBand 2');
    this.ble.startNotification(this.device.id, UUID_SERVICE_MIBAND_2, UUID_AUTH_SERVICE).subscribe(
      (data: number[]) => {
        this.handleCommunicationResponse(data);
      },
      (e) => console.log('AUTH NOTIFICATION: - unexpected error: ', e)
    );
    console.log('Subscribed to AUTH notifications');

    // working
    this.startAuthentication();

    // this.readHeartRate();
    // Notifications should be enabled after auth
    // await this.startNotificationsFor(['hrm_data']);
  }

  startAuthentication() {
    this.sendEncryptionKeyToDevice();
  }

  requestRandomData() {
    this.ble.writeWithoutResponse(this.device.id, UUID_SERVICE_MIBAND_2, UUID_AUTH_SERVICE, new Uint8Array([0x02, 0x08]).buffer)
      .then(success => {
        console.log('Requested random data from device. status: ', success);
      }, rejection => {
        console.log('Requesting random data error: ', rejection);
      });
  }

  sendEncryptedResponseData(data) {
    const aesEcb = new AES.ModeOfOperation.ecb(this.encryptionKey);
    const encryptedBytes = aesEcb.encrypt(data);
    const sendingData = [0x03, 0x08, ...encryptedBytes];

    this.ble.writeWithoutResponse(this.device.id, UUID_SERVICE_MIBAND_2, UUID_AUTH_SERVICE, new Uint8Array(sendingData).buffer)
      .then(success => {
        console.log('Sent encrypted data back to device. status: ', success);
      }, rejection => {
        console.log('sendEncryptedKey error: ', rejection);
      });
  }

  sendEncryptionKeyToDevice() {
    this.ble.writeWithoutResponse(this.device.id, UUID_SERVICE_MIBAND_2, UUID_AUTH_SERVICE,
      new Uint8Array([0x01, 0x08, ...this.encryptionKey]).buffer)
      .then(success => {
        console.log('Sent encryption key to device. status: ', success);
      }, rejection => {
        console.log('Encryption Key Auth Fail, sending new key FAILED!', rejection);
      });
  }

  // HANDLER
  handleCommunicationResponse(data: number[]) {
    console.log(data[0]);

    const buffer = new Uint8Array(data[0]);
    const responseArray = Array.from(new Uint8Array(buffer));
    console.log('responseArray: ', responseArray);

    const response = responseArray.map(b => (b.toString(16)).padStart(2, '0')).join('');
    const communicationResponseCode = response.slice(0, 6);
    console.log('communicationResponseCode: ', communicationResponseCode);

    if (communicationResponseCode === '100101') { // set new key ok
      console.log('New key has been set successfully');
      this.requestRandomData();
    } else if (communicationResponseCode === '100201') { // request random data ok
      console.log('Random data has been received successfully');
      const dataToEncode = responseArray.slice(3);
      this.sendEncryptedResponseData(dataToEncode);
    } else if (communicationResponseCode === '100301') {
      console.log('Successfully authenticated to selected MiBand2');
      this.toasterService.showSuccess('Device successfully connected');
      this.subscribeToServices();
    } else if (communicationResponseCode === '100304') { // encryption fail
      console.log('ERROR => Encryption failed.');
      this.sendEncryptionKeyToDevice();
    } else if (communicationResponseCode === '100104') {  // Set New Key FAIL
      console.log('ERROR => Set new key failed.');
    } else if (communicationResponseCode === '100204') {  // Req Random Number FAIL
      console.log('ERROR => Request random number failed.');
    }
  }

  subscribeToServices() {
    this.ble.startNotification(this.device.id, UUID_SERVICE_HEART_RATE, UUID_HEART_RATE_LISTENER).subscribe(
      notificationData => {
        const buffer = new Uint8Array(notificationData[0]);
        const responseArray = Array.from(buffer);
        console.log('Heart rate: ' + responseArray[1]);

        // send hearRate data to the buffer service
        this.bufferService.updateLatestHeartRateValueDataSource({
          time: new Date().getTime(),
          heartRateValue: responseArray[1]
        });
      },
      (e) => console.log('ERROR => Heart rate listener notification: ', e)
    );

    this.startListeningDeviceConnection();

    console.log('Subscribed to heart rate listener');
  }

  private startListeningDeviceConnection() {
    let connectionCheckInterval = setInterval( () => {
      this.ble.isConnected(this.device.id).then(connected => {
        console.log('Device connection check => connected: ', connected);
        if (!connected) {
          this.toasterService.showFatalWarning('\n\nDEVICE DISCONNECTED!\n\n');
          clearInterval(connectionCheckInterval);
          connectionCheckInterval = undefined;
        }
      }, () => {
        this.toasterService.showFatalWarning('\n\nDEVICE DISCONNECTED!\n\n\n');
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = undefined;
      });
    }, 3000);
    console.log('Initialized connection check listener.');
  }

  async readHeartRate() {
    console.log('Started heart-rate monitoring');

    this.ble.write(this.device.id, UUID_SERVICE_HEART_RATE, UUID_HEART_RATE_CONTROL, new Uint8Array([0x15, 0x02, 0x00]).buffer)
      .then(value => console.log(value));
    this.ble.write(this.device.id, UUID_SERVICE_HEART_RATE, UUID_HEART_RATE_CONTROL, new Uint8Array([0x15, 0x01, 0x00]).buffer)
      .then(value => console.log(value));
    this.ble.write(this.device.id, UUID_SERVICE_HEART_RATE, UUID_HEART_RATE_CONTROL, new Uint8Array([0x15, 0x01, 0x01]).buffer)
      .then(value => console.log(value));
    console.log('Sent heart-rate monitor commands to device.');

    // interval for continuous HRM read
    this.hrmTimer = this.hrmTimer || setInterval(() => {
      console.log('12 seconds interval HRM Pinging...');
      this.ble.write(this.device.id, UUID_SERVICE_HEART_RATE, UUID_HEART_RATE_CONTROL, new Uint8Array([0x16]).buffer)
        .then(value => console.log(value));
    }, 12000);
  }

  async hrmStop() {
    clearInterval(this.hrmTimer);
    this.hrmTimer = undefined;
    this.ble.write(this.device.id, UUID_SERVICE_HEART_RATE, UUID_HEART_RATE_CONTROL, new Uint8Array([0x15, 0x01, 0x00]).buffer)
      .then(value => {
        console.log(value);
        this.bufferService.updateLatestHeartRateValueDataSource(null);
      });
  }

  sendVibrationSignal() {
    this.ble.writeWithoutResponse(this.device.id, UUID_SERVICE_NOTIFICATION, UUID_NOTIFICATION_CONTROL, new Uint8Array([0x03]).buffer);
  }
}
