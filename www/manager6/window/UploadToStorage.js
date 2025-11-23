Ext.define('PVE.window.UploadToStorage', {
    extend: 'Ext.window.Window',
    alias: 'widget.pveStorageUpload',
    mixins: ['Proxmox.Mixin.CBind'],

    resizable: false,
    modal: true,

    title: gettext('Upload'),

    acceptedExtensions: {
        import: ['.ova', '.qcow2', '.raw', '.vmdk'],
        iso: ['.img', '.iso'],
        vztmpl: ['.tar.gz', '.tar.xz', '.tar.zst'],
    },

    // accepted for file selection, will be renamed to real extension
    extensionAliases: {
        import: {
            '.img': '.raw',
        },
    },

    cbindData: function (initialConfig) {
        const me = this;
        const ext = me.acceptedExtensions[me.content] || [];

        me.url = `/nodes/${me.nodename}/storage/${me.storage}/upload`;

        let fileSelectorExt = ext.concat(Object.keys(me.extensionAliases[me.content] ?? {}));

        return {
            extensions: fileSelectorExt.join(', '),
            filenameRegex: new RegExp('^.*(?:' + ext.join('|').replaceAll('.', '\\.') + ')$', 'i'),
        };
    },

    viewModel: {
        data: {
            size: '-',
            mimetype: '-',
            filename: '',
        },
    },

    controller: {
        submit: function (button) {
            const view = this.getView();
            const form = this.lookup('formPanel').getForm();
            const abortBtn = this.lookup('abortBtn');
            const pbar = this.lookup('progressBar');

            const updateProgress = function (per, bytes) {
                let text = (per * 100).toFixed(2) + '%';
                if (bytes) {
                    text += ' (' + Proxmox.Utils.format_size(bytes) + ')';
                }
                pbar.updateProgress(per, text);
            };

            const fd = new FormData();

            button.setDisabled(true);
            abortBtn.setDisabled(false);

            fd.append('content', view.content);

            const fileField = form.findField('file');
            const file = fileField.fileInputEl.dom.files[0];
            fileField.setDisabled(true);

            const filenameField = form.findField('filename');
            const filename = filenameField.getValue();
            filenameField.setDisabled(true);

            const algorithmField = form.findField('checksum-algorithm');
            algorithmField.setDisabled(true);
            if (algorithmField.getValue() !== '__default__') {
                fd.append('checksum-algorithm', algorithmField.getValue());

                const checksumField = form.findField('checksum');
                fd.append('checksum', checksumField.getValue()?.trim());
                checksumField.setDisabled(true);
            }

            fd.append('filename', file, filename);

            pbar.setVisible(true);
            updateProgress(0);

            const xhr = new XMLHttpRequest();
            view.xhr = xhr;

            xhr.addEventListener(
                'load',
                function (e) {
                    if (xhr.status === 200) {
                        view.hide();

                        const result = JSON.parse(xhr.response);
                        const upid = result.data;
                        Ext.create('Proxmox.window.TaskViewer', {
                            autoShow: true,
                            upid: upid,
                            taskDone: view.taskDone,
                            listeners: {
                                destroy: function () {
                                    view.close();
                                },
                            },
                        });

                        return;
                    }
                    const err = Ext.htmlEncode(xhr.statusText);
                    let msg = `${gettext('Error')} ${xhr.status.toString()}: ${err}`;
                    if (xhr.responseText !== '') {
                        const result = Ext.decode(xhr.responseText);
                        result.message = msg;
                        msg = Proxmox.Utils.extractRequestError(result, true);
                    }
                    Ext.Msg.alert(gettext('Error'), msg, (btn) => view.close());
                },
                false,
            );

            xhr.addEventListener('error', function (e) {
                const err = e.target.status.toString();
                const msg = `Error '${err}' occurred while receiving the document.`;
                Ext.Msg.alert(gettext('Error'), msg, (btn) => view.close());
            });

            xhr.upload.addEventListener(
                'progress',
                function (evt) {
                    if (evt.lengthComputable) {
                        const percentComplete = evt.loaded / evt.total;
                        updateProgress(percentComplete, evt.loaded);
                    }
                },
                false,
            );

            xhr.open('POST', `/api2/json${view.url}`, true);
            xhr.send(fd);
        },

        validitychange: function (f, valid) {
            const submitBtn = this.lookup('submitBtn');
            submitBtn.setDisabled(!valid);
        },

        fileChange: function (input) {
            const me = this;
            const vm = me.getViewModel();
            const view = me.getView();
            let name = input.value.replace(/^.*(\/|\\)/, '');
            for (const [alias, real] of Object.entries(view.extensionAliases[view.content] ?? {})) {
                if (name.endsWith(alias)) {
                    name += real;
                }
            }
            const fileInput = input.fileInputEl.dom;
            vm.set('filename', name);
            vm.set(
                'size',
                (fileInput.files[0] && Proxmox.Utils.format_size(fileInput.files[0].size)) || '-',
            );
            vm.set('mimetype', (fileInput.files[0] && fileInput.files[0].type) || '-');
        },

        hashChange: function (field, value) {
            const checksum = this.lookup('downloadUrlChecksum');
            if (value === '__default__') {
                checksum.setDisabled(true);
                checksum.setValue('');
            } else {
                checksum.setDisabled(false);
            }
        },
    },

    items: [
        {
            xtype: 'form',
            reference: 'formPanel',
            method: 'POST',
            waitMsgTarget: true,
            bodyPadding: 10,
            border: false,
            width: 400,
            fieldDefaults: {
                labelWidth: 100,
                anchor: '100%',
            },
            items: [
                {
                    xtype: 'filefield',
                    name: 'file',
                    buttonText: gettext('Select File'),
                    allowBlank: false,
                    fieldLabel: gettext('File'),
                    cbind: {
                        accept: '{extensions}',
                    },
                    listeners: {
                        change: 'fileChange',
                    },
                },
                {
                    xtype: 'textfield',
                    name: 'filename',
                    allowBlank: false,
                    fieldLabel: gettext('File name'),
                    bind: {
                        value: '{filename}',
                    },
                    cbind: {
                        regex: '{filenameRegex}',
                    },
                    regexText: gettext('Wrong file extension'),
                },
                {
                    xtype: 'displayfield',
                    name: 'size',
                    fieldLabel: gettext('File size'),
                    bind: {
                        value: '{size}',
                    },
                },
                {
                    xtype: 'displayfield',
                    name: 'mimetype',
                    fieldLabel: gettext('MIME type'),
                    bind: {
                        value: '{mimetype}',
                    },
                },
                {
                    xtype: 'pveHashAlgorithmSelector',
                    name: 'checksum-algorithm',
                    fieldLabel: gettext('Hash algorithm'),
                    allowBlank: true,
                    hasNoneOption: true,
                    value: '__default__',
                    listeners: {
                        change: 'hashChange',
                    },
                },
                {
                    xtype: 'textfield',
                    name: 'checksum',
                    fieldLabel: gettext('Checksum'),
                    allowBlank: false,
                    disabled: true,
                    emptyText: gettext('none'),
                    reference: 'downloadUrlChecksum',
                },
                {
                    xtype: 'displayfield',
                    userCls: 'pmx-hint',
                    value: gettext(
                        "Uploads are stored temporarily in '/var/tmp/', make sure there is enough free space.",
                    ),
                },
                {
                    xtype: 'progressbar',
                    text: 'Ready',
                    hidden: true,
                    reference: 'progressBar',
                },
                {
                    xtype: 'hiddenfield',
                    name: 'content',
                    cbind: {
                        value: '{content}',
                    },
                },
            ],
            listeners: {
                validitychange: 'validitychange',
            },
        },
    ],

    buttons: [
        {
            xtype: 'button',
            text: gettext('Abort'),
            reference: 'abortBtn',
            disabled: true,
            handler: function () {
                const me = this;
                me.up('pveStorageUpload').close();
            },
        },
        {
            text: gettext('Upload'),
            reference: 'submitBtn',
            disabled: true,
            handler: 'submit',
        },
    ],

    listeners: {
        close: function () {
            const me = this;
            if (me.xhr) {
                me.xhr.abort();
                delete me.xhr;
            }
        },
    },

    initComponent: function () {
        const me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        if (!me.storage) {
            throw 'no storage ID specified';
        }
        if (!me.acceptedExtensions[me.content]) {
            throw 'content type not supported';
        }

        me.callParent();
    },
});
