/*global QRCode*/
Ext.define('PVE.Storage.PBSKeyShow', {
    extend: 'Ext.window.Window',
    xtype: 'pvePBSKeyShow',
    mixins: ['Proxmox.Mixin.CBind'],

    width: 600,
    modal: true,
    resizable: false,
    title: gettext('Important: Save your Encryption Key'),

    // avoid that esc closes this by mistake, force user to more manual action
    onEsc: Ext.emptyFn,
    closable: false,

    items: [
        {
            xtype: 'form',
            layout: {
                type: 'vbox',
                align: 'stretch',
            },
            bodyPadding: 10,
            border: false,
            defaults: {
                anchor: '100%',
                border: false,
                padding: '10 0 0 0',
            },
            items: [
                {
                    xtype: 'textfield',
                    fieldLabel: gettext('Key'),
                    labelWidth: 80,
                    inputId: 'encryption-key-value',
                    cbind: {
                        value: '{key}',
                    },
                    editable: false,
                },
                {
                    xtype: 'component',
                    html:
                        gettext(
                            'Keep your encryption key safe, but easily accessible for disaster recovery.',
                        ) +
                        '<br>' +
                        gettext('We recommend the following safe-keeping strategy:'),
                },
                {
                    xtyp: 'container',
                    layout: 'hbox',
                    items: [
                        {
                            xtype: 'component',
                            html: '1. ' + gettext('Save the key in your password manager.'),
                            flex: 1,
                        },
                        {
                            xtype: 'button',
                            text: gettext('Copy Key'),
                            iconCls: 'fa fa-clipboard x-btn-icon-el-default-toolbar-small',
                            cls: 'x-btn-default-toolbar-small proxmox-inline-button',
                            width: 110,
                            handler: function (b) {
                                document.getElementById('encryption-key-value').select();
                                document.execCommand('copy');
                            },
                        },
                    ],
                },
                {
                    xtype: 'container',
                    layout: 'hbox',
                    items: [
                        {
                            xtype: 'component',
                            html:
                                '2. ' +
                                gettext(
                                    'Download the key to a USB (pen) drive, placed in secure vault.',
                                ),
                            flex: 1,
                        },
                        {
                            xtype: 'button',
                            text: gettext('Download'),
                            iconCls: 'fa fa-download x-btn-icon-el-default-toolbar-small',
                            cls: 'x-btn-default-toolbar-small proxmox-inline-button',
                            width: 110,
                            handler: function (b) {
                                let win = this.up('window');

                                let pveID = PVE.ClusterName || window.location.hostname;
                                let name = `pve-${pveID}-storage-${win.sid}.enc`;

                                let hiddenElement = document.createElement('a');
                                hiddenElement.href = 'data:attachment/text,' + encodeURI(win.key);
                                hiddenElement.target = '_blank';
                                hiddenElement.download = name;
                                hiddenElement.click();
                            },
                        },
                    ],
                },
                {
                    xtype: 'container',
                    layout: 'hbox',
                    items: [
                        {
                            xtype: 'component',
                            html:
                                '3. ' +
                                gettext('Print as paperkey, laminated and placed in secure vault.'),
                            flex: 1,
                        },
                        {
                            xtype: 'button',
                            text: gettext('Print Key'),
                            iconCls: 'fa fa-print x-btn-icon-el-default-toolbar-small',
                            cls: 'x-btn-default-toolbar-small proxmox-inline-button',
                            width: 110,
                            handler: function (b) {
                                let win = this.up('window');
                                win.paperkey(win.key);
                            },
                        },
                    ],
                },
            ],
        },
        {
            xtype: 'component',
            border: false,
            padding: '10 10 10 10',
            userCls: 'pmx-hint',
            html: gettext(
                'Please save the encryption key - losing it will render any backup created with it unusable',
            ),
        },
    ],
    buttons: [
        {
            text: gettext('Close'),
            handler: function (b) {
                let win = this.up('window');
                win.close();
            },
        },
    ],
    paperkey: function (keyString) {
        let me = this;

        const key = JSON.parse(keyString);

        const qrwidth = 500;
        let qrdiv = document.createElement('div');
        let qrcode = new QRCode(qrdiv, {
            width: qrwidth,
            height: qrwidth,
            correctLevel: QRCode.CorrectLevel.H,
        });
        qrcode.makeCode(keyString);

        let shortKeyFP = '';
        if (key.fingerprint) {
            shortKeyFP = PVE.Utils.render_pbs_fingerprint(key.fingerprint);
        }

        let printFrame = document.createElement('iframe');
        Object.assign(printFrame.style, {
            position: 'fixed',
            right: '0',
            bottom: '0',
            width: '0',
            height: '0',
            border: '0',
        });
        const prettifiedKey = JSON.stringify(key, null, 2);
        const keyQrBase64 = qrdiv.children[0].toDataURL('image/png');
        const html = `<html><head><script>
	    window.addEventListener('DOMContentLoaded', (ev) => window.print());
	</script><style>@media print and (max-height: 150mm) {
	  h4, p { margin: 0; font-size: 1em; }
	}</style></head><body style="padding: 5px;">
	<h4>Encryption Key - Storage '${me.sid}' (${shortKeyFP})</h4>
<p style="font-size:1.2em;font-family:monospace;white-space:pre-wrap;overflow-wrap:break-word;">
-----BEGIN PROXMOX BACKUP KEY-----
${prettifiedKey}
-----END PROXMOX BACKUP KEY-----</p>
	<center><img style="width: 100%; max-width: ${qrwidth}px;" src="${keyQrBase64}"></center>
	</body></html>`;

        printFrame.src = 'data:text/html;base64,' + btoa(html);
        document.body.appendChild(printFrame);
        me.on('destroy', () => document.body.removeChild(printFrame));
    },
});

Ext.define('PVE.panel.PBSEncryptionKeyTab', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pvePBSEncryptionKeyTab',
    mixins: ['Proxmox.Mixin.CBind'],

    onlineHelp: 'storage_pbs_encryption',

    onGetValues: function (form) {
        let values = {};
        if (form.cryptMode === 'upload') {
            values['encryption-key'] = form['crypt-key-upload'];
        } else if (form.cryptMode === 'autogenerate') {
            values['encryption-key'] = 'autogen';
        } else if (form.cryptMode === 'none') {
            if (!this.isCreate) {
                values.delete = ['encryption-key'];
            }
        }
        return values;
    },

    setValues: function (values) {
        let me = this;
        let vm = me.getViewModel();

        let cryptKeyInfo = values['encryption-key'];
        if (cryptKeyInfo) {
            let icon = '<span class="fa fa-lock good"></span> ';
            if (cryptKeyInfo.match(/^[a-fA-F0-9]{2}:/)) {
                // new style fingerprint
                let shortKeyFP = PVE.Utils.render_pbs_fingerprint(cryptKeyInfo);
                values['crypt-key-fp'] =
                    icon + `${gettext('Active')} - ${gettext('Fingerprint')} ${shortKeyFP}`;
            } else {
                // old key without FP
                values['crypt-key-fp'] = icon + gettext('Active');
            }
            values.cryptMode = 'keep';
            values['crypt-allow-edit'] = false;
        } else {
            values['crypt-key-fp'] = gettext('None');
            let cryptModeNone = me.down('radiofield[inputValue=none]');
            cryptModeNone.setBoxLabel(gettext('Do not encrypt backups'));
            values.cryptMode = 'none';
            values['crypt-allow-edit'] = true;
        }
        vm.set('keepCryptVisible', !!cryptKeyInfo);
        vm.set('allowEdit', !cryptKeyInfo);

        me.callParent([values]);
    },

    viewModel: {
        data: {
            allowEdit: true,
            keepCryptVisible: false,
        },
        formulas: {
            showDangerousHint: (get) => {
                let allowEdit = get('allowEdit');
                return get('keepCryptVisible') && allowEdit;
            },
        },
    },

    items: [
        {
            xtype: 'displayfield',
            name: 'crypt-key-fp',
            fieldLabel: gettext('Encryption Key'),
            padding: '2 0',
        },
        {
            xtype: 'checkbox',
            name: 'crypt-allow-edit',
            boxLabel: gettext('Edit existing encryption key (dangerous!)'),
            hidden: true,
            submitValue: false,
            isDirty: () => false,
            bind: {
                hidden: '{!keepCryptVisible}',
                value: '{allowEdit}',
            },
        },
        {
            xtype: 'radiofield',
            name: 'cryptMode',
            inputValue: 'keep',
            boxLabel: gettext('Keep encryption key'),
            padding: '0 0 0 25',
            cbind: {
                hidden: '{isCreate}',
            },
            bind: {
                hidden: '{!keepCryptVisible}',
                disabled: '{!allowEdit}',
            },
        },
        {
            xtype: 'radiofield',
            name: 'cryptMode',
            inputValue: 'none',
            checked: true,
            padding: '0 0 0 25',
            cbind: {
                disabled: '{!isCreate}',
                checked: '{isCreate}',
                boxLabel: (get) =>
                    get('isCreate')
                        ? gettext('Do not encrypt backups')
                        : gettext('Delete existing encryption key'),
            },
            bind: {
                disabled: '{!allowEdit}',
            },
        },
        {
            xtype: 'radiofield',
            name: 'cryptMode',
            inputValue: 'autogenerate',
            boxLabel: gettext('Auto-generate a client encryption key'),
            padding: '0 0 0 25',
            cbind: {
                disabled: '{!isCreate}',
            },
            bind: {
                disabled: '{!allowEdit}',
            },
        },
        {
            xtype: 'radiofield',
            name: 'cryptMode',
            inputValue: 'upload',
            boxLabel: gettext('Upload an existing client encryption key'),
            padding: '0 0 0 25',
            cbind: {
                disabled: '{!isCreate}',
            },
            bind: {
                disabled: '{!allowEdit}',
            },
            listeners: {
                change: function (f, value) {
                    let panel = this.up('inputpanel');
                    if (!panel.rendered) {
                        return;
                    }
                    let uploadKeyField = panel.down('field[name=crypt-key-upload]');
                    uploadKeyField.setDisabled(!value);
                    uploadKeyField.setHidden(!value);

                    let uploadKeyButton = panel.down('filebutton[name=crypt-upload-button]');
                    uploadKeyButton.setDisabled(!value);
                    uploadKeyButton.setHidden(!value);

                    if (value) {
                        uploadKeyField.validate();
                    } else {
                        uploadKeyField.reset();
                    }
                },
            },
        },
        {
            xtype: 'fieldcontainer',
            layout: 'hbox',
            items: [
                {
                    xtype: 'proxmoxtextfield',
                    name: 'crypt-key-upload',
                    fieldLabel: gettext('Key'),
                    value: '',
                    disabled: true,
                    hidden: true,
                    allowBlank: false,
                    labelAlign: 'right',
                    flex: 1,
                    emptyText: gettext('You can drag-and-drop a key file here.'),
                    validator: function (value) {
                        if (value.length) {
                            let key;
                            try {
                                key = JSON.parse(value);
                            } catch (e) {
                                return 'Failed to parse key - ' + e;
                            }
                            if (key.data === undefined) {
                                return 'Does not seems like a valid Proxmox Backup key!';
                            }
                        }
                        return true;
                    },
                    afterRender: function () {
                        if (!window.FileReader) {
                            // No FileReader support in this browser
                            return;
                        }
                        let cancel = function (ev) {
                            ev = ev.event;
                            if (ev.preventDefault) {
                                ev.preventDefault();
                            }
                        };
                        this.inputEl.on('dragover', cancel);
                        this.inputEl.on('dragenter', cancel);
                        this.inputEl.on('drop', (ev) => {
                            cancel(ev);
                            let files = ev.event.dataTransfer.files;
                            PVE.Utils.loadTextFromFile(files[0], (v) => this.setValue(v));
                        });
                    },
                },
                {
                    xtype: 'filebutton',
                    name: 'crypt-upload-button',
                    iconCls: 'fa fa-fw fa-folder-open-o x-btn-icon-el-default-toolbar-small',
                    cls: 'x-btn-default-toolbar-small proxmox-inline-button',
                    margin: '0 0 0 4',
                    disabled: true,
                    hidden: true,
                    listeners: {
                        change: function (btn, e, value) {
                            let ev = e.event;
                            let field = btn.up().down('proxmoxtextfield[name=crypt-key-upload]');
                            PVE.Utils.loadTextFromFile(ev.target.files[0], (v) =>
                                field.setValue(v),
                            );
                            btn.reset();
                        },
                    },
                },
            ],
        },
        {
            xtype: 'component',
            border: false,
            padding: '5 2',
            userCls: 'pmx-hint',
            html: // `<b style="color:red;font-weight:600;">${ngettext('Warning', 'Warnings', 1)}</b>: ` +
                `<span class="fa fa-exclamation-triangle" style="color:red;font-size:14px;"></span> ` +
                gettext(
                    'Deleting or replacing the encryption key will break restoring backups created with it!',
                ),
            hidden: true,
            bind: {
                hidden: '{!showDangerousHint}',
            },
        },
    ],
});

Ext.define('PVE.storage.PBSInputPanel', {
    extend: 'PVE.panel.StorageBase',

    onlineHelp: 'storage_pbs',

    apiCallDone: function (success, response, options) {
        let res = response.result.data;
        if (!(res && res.config && res.config['encryption-key'])) {
            return;
        }
        let key = res.config['encryption-key'];
        Ext.create('PVE.Storage.PBSKeyShow', {
            autoShow: true,
            sid: res.storage,
            key: key,
        });
    },

    isPBS: true, // HACK

    extraTabs: [
        {
            xtype: 'pvePBSEncryptionKeyTab',
            title: gettext('Encryption'),
        },
    ],

    setValues: function (values) {
        let me = this;

        let server = values.server;
        if (values.port !== undefined) {
            if (Proxmox.Utils.IP6_match.test(server)) {
                server = `[${server}]`;
            }
            server += `:${values.port}`;
        }
        values.hostport = server;

        return me.callParent([values]);
    },

    initComponent: function () {
        var me = this;

        me.column1 = [
            {
                xtype: me.isCreate ? 'proxmoxtextfield' : 'displayfield',
                fieldLabel: gettext('Server'),
                allowBlank: false,
                name: 'hostport',
                submitValue: false,
                vtype: 'HostPort',
                listeners: {
                    change: function (field, newvalue) {
                        let server = newvalue;
                        let port;

                        let match = Proxmox.Utils.HostPort_match.exec(newvalue);
                        if (match === null) {
                            match = Proxmox.Utils.HostPortBrackets_match.exec(newvalue);
                            if (match === null) {
                                match = Proxmox.Utils.IP6_dotnotation_match.exec(newvalue);
                            }
                        }

                        if (match !== null) {
                            server = match[1];
                            if (match[2] !== undefined) {
                                port = match[2];
                            }
                        }

                        field.up('inputpanel').down('field[name=server]').setValue(server);
                        field.up('inputpanel').down('field[name=port]').setValue(port);
                    },
                },
            },
            {
                xtype: 'proxmoxtextfield',
                hidden: true,
                name: 'server',
                submitValue: me.isCreate, // it is fixed
            },
            {
                xtype: 'proxmoxtextfield',
                hidden: true,
                deleteEmpty: !me.isCreate,
                name: 'port',
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'username',
                value: '',
                emptyText: gettext('Example') + ': admin@pbs',
                fieldLabel: gettext('Username'),
                regex: /\S+@\w+/,
                regexText: gettext('Example') + ': admin@pbs',
                allowBlank: false,
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                inputType: 'password',
                name: 'password',
                value: me.isCreate ? '' : '********',
                emptyText: me.isCreate ? gettext('None') : '',
                fieldLabel: gettext('Password'),
                allowBlank: false,
            },
        ];

        me.column2 = [
            {
                xtype: 'displayfield',
                name: 'content',
                value: 'backup',
                submitValue: true,
                fieldLabel: gettext('Content'),
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'datastore',
                value: '',
                fieldLabel: 'Datastore',
                allowBlank: false,
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'namespace',
                value: '',
                emptyText: gettext('Root'),
                fieldLabel: gettext('Namespace'),
                allowBlank: true,
            },
        ];

        me.columnB = [
            {
                xtype: 'pmxFingerprintField',
                name: 'fingerprint',
                value: me.isCreate ? null : undefined,
                deleteEmpty: !me.isCreate,
            },
        ];

        me.callParent();
    },
});
