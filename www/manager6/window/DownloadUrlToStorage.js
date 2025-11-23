Ext.define('PVE.window.DownloadUrlToStorage', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveStorageDownloadUrl',
    mixins: ['Proxmox.Mixin.CBind'],

    isCreate: true,

    method: 'POST',

    showTaskViewer: true,

    title: gettext('Download from URL'),
    submitText: gettext('Download'),

    cbindData: function (initialConfig) {
        var me = this;
        return {
            nodename: me.nodename,
            storage: me.storage,
            content: me.content,
        };
    },

    cbind: {
        url: '/nodes/{nodename}/storage/{storage}/download-url',
    },

    viewModel: {
        data: {
            size: '-',
            mimetype: '-',
            enableQuery: true,
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        urlChange: function (field) {
            this.resetMetaInfo();
            this.setQueryEnabled();
        },
        setQueryEnabled: function () {
            this.getViewModel().set('enableQuery', true);
        },
        resetMetaInfo: function () {
            let vm = this.getViewModel();
            vm.set('size', '-');
            vm.set('mimetype', '-');
        },

        urlCheck: function (field) {
            let me = this;
            let view = me.getView();

            const queryParam = view.getValues();

            me.getViewModel().set('enableQuery', false);
            me.resetMetaInfo();
            let urlField = view.down('[name=url]');

            Proxmox.Utils.API2Request({
                url: `/nodes/${view.nodename}/query-url-metadata`,
                method: 'GET',
                params: {
                    url: queryParam.url,
                    'verify-certificates': queryParam['verify-certificates'],
                },
                waitMsgTarget: view,
                failure: (res) => {
                    urlField.setValidation(res.result.message);
                    urlField.validate();
                    Ext.MessageBox.alert(gettext('Error'), res.htmlStatus);
                    // re-enable so one can directly requery, e.g., if it was just a network hiccup
                    me.setQueryEnabled();
                },
                success: function (res, opt) {
                    urlField.setValidation();
                    urlField.validate();

                    let data = res.result.data;

                    let filename = data.filename || '';
                    let compression = '__default__';
                    if (view.content === 'iso') {
                        const matches = filename.match(/^(.+)\.(gz|lzo|zst|bz2)$/i);
                        if (matches) {
                            filename = matches[1];
                            compression = matches[2].toLowerCase();
                        }
                    } else if (view.content === 'import') {
                        if (filename.endsWith('.img')) {
                            filename += '.raw';
                        }
                    }

                    view.setValues({
                        filename,
                        compression,
                        size:
                            (data.size && Proxmox.Utils.format_size(data.size)) ||
                            gettext('Unknown'),
                        mimetype: data.mimetype || gettext('Unknown'),
                    });
                },
            });
        },

        hashChange: function (field) {
            let checksum = Ext.getCmp('downloadUrlChecksum');
            if (field.getValue() === '__default__') {
                checksum.setDisabled(true);
                checksum.setValue('');
                checksum.allowBlank = true;
            } else {
                checksum.setDisabled(false);
                checksum.allowBlank = false;
            }
        },
    },

    items: [
        {
            xtype: 'inputpanel',
            border: false,
            onGetValues: function (values) {
                if (typeof values.checksum === 'string') {
                    values.checksum = values.checksum.trim();
                }
                return values;
            },
            columnT: [
                {
                    xtype: 'fieldcontainer',
                    layout: 'hbox',
                    fieldLabel: gettext('URL'),
                    items: [
                        {
                            xtype: 'textfield',
                            name: 'url',
                            emptyText: gettext('Enter URL to download'),
                            allowBlank: false,
                            flex: 1,
                            listeners: {
                                change: 'urlChange',
                            },
                        },
                        {
                            xtype: 'button',
                            name: 'check',
                            text: gettext('Query URL'),
                            margin: '0 0 0 5',
                            bind: {
                                disabled: '{!enableQuery}',
                            },
                            listeners: {
                                click: 'urlCheck',
                            },
                        },
                    ],
                },
                {
                    xtype: 'textfield',
                    name: 'filename',
                    allowBlank: false,
                    fieldLabel: gettext('File name'),
                    emptyText: gettext('Please (re-)query URL to get meta information'),
                },
            ],
            column1: [
                {
                    xtype: 'displayfield',
                    name: 'size',
                    fieldLabel: gettext('File size'),
                    bind: {
                        value: '{size}',
                    },
                },
            ],
            column2: [
                {
                    xtype: 'displayfield',
                    name: 'mimetype',
                    fieldLabel: gettext('MIME type'),
                    bind: {
                        value: '{mimetype}',
                    },
                },
            ],
            advancedColumn1: [
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
                    allowBlank: true,
                    disabled: true,
                    emptyText: gettext('none'),
                    id: 'downloadUrlChecksum',
                },
            ],
            advancedColumn2: [
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'verify-certificates',
                    fieldLabel: gettext('Verify certificates'),
                    uncheckedValue: 0,
                    checked: true,
                    listeners: {
                        change: 'setQueryEnabled',
                    },
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'compression',
                    fieldLabel: gettext('Decompression algorithm'),
                    allowBlank: true,
                    hasNoneOption: true,
                    deleteEmpty: false,
                    value: '__default__',
                    comboItems: [
                        ['__default__', Proxmox.Utils.NoneText],
                        ['lzo', 'LZO'],
                        ['gz', 'GZIP'],
                        ['zst', 'ZSTD'],
                        ['bz2', 'BZIP2'],
                    ],
                    cbind: {
                        hidden: (get) => get('content') !== 'iso',
                    },
                },
            ],
        },
        {
            xtype: 'hiddenfield',
            name: 'content',
            cbind: {
                value: '{content}',
            },
        },
    ],

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        if (!me.storage) {
            throw 'no storage ID specified';
        }
        me.callParent();
    },
});
