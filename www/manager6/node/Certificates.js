Ext.define('PVE.node.CertificateView', {
    extend: 'Ext.container.Container',
    xtype: 'pveCertificatesView',

    onlineHelp: 'sysadmin_certificate_management',

    mixins: ['Proxmox.Mixin.CBind'],
    scrollable: 'y',

    items: [
        {
            xtype: 'pveCertView',
            border: 0,
            cbind: {
                nodename: '{nodename}',
            },
        },
        {
            xtype: 'pveACMEView',
            border: 0,
            cbind: {
                nodename: '{nodename}',
            },
        },
    ],
});

Ext.define('PVE.node.CertificateViewer', {
    extend: 'Proxmox.window.Edit',

    title: gettext('Certificate'),

    fieldDefaults: {
        labelWidth: 120,
    },
    width: 800,

    items: {
        xtype: 'inputpanel',
        maxHeight: 900,
        scrollable: 'y',
        columnT: [
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Name'),
                name: 'filename',
            },
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Fingerprint'),
                name: 'fingerprint',
            },
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Issuer'),
                name: 'issuer',
            },
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Subject'),
                name: 'subject',
            },
        ],
        column1: [
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Public Key Type'),
                name: 'public-key-type',
            },
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Public Key Size'),
                name: 'public-key-bits',
            },
        ],
        column2: [
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Valid Since'),
                renderer: Proxmox.Utils.render_timestamp,
                name: 'notbefore',
            },
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Expires'),
                renderer: Proxmox.Utils.render_timestamp,
                name: 'notafter',
            },
        ],
        columnB: [
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Subject Alternative Names'),
                name: 'san',
                renderer: PVE.Utils.render_san,
            },
            {
                xtype: 'fieldset',
                title: gettext('Raw Certificate'),
                collapsible: true,
                collapsed: true,
                items: [
                    {
                        xtype: 'textarea',
                        name: 'pem',
                        editable: false,
                        grow: true,
                        growMax: 350,
                        fieldStyle: {
                            'white-space': 'pre-wrap',
                            'font-family': 'monospace',
                        },
                    },
                ],
            },
        ],
    },

    initComponent: function () {
        let me = this;

        if (!me.cert) {
            throw 'no cert given';
        }
        if (!me.nodename) {
            throw 'no nodename given';
        }

        me.url = `/nodes/${me.nodename}/certificates/info`;
        me.callParent();

        // hide OK/Reset button, because we just want to show data
        me.down('toolbar[dock=bottom]').setVisible(false);

        me.load({
            success: function (response) {
                if (Ext.isArray(response.result.data)) {
                    for (const item of response.result.data) {
                        if (item.filename === me.cert) {
                            me.setValues(item);
                            return;
                        }
                    }
                }
            },
        });
    },
});

Ext.define('PVE.node.CertUpload', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveCertUpload',

    title: gettext('Upload Custom Certificate'),
    resizable: false,
    isCreate: true,
    submitText: gettext('Upload'),
    method: 'POST',
    width: 600,

    apiCallDone: function (success, response, options) {
        if (!success) {
            return;
        }
        let txt = gettext(
            'API server will be restarted to use new certificates, please reload web-interface!',
        );
        Ext.getBody().mask(txt, ['pve-static-mask']);
        Ext.defer(() => window.location.reload(true), 10000); // reload after 10 seconds automatically
    },

    items: {
        xtype: 'inputpanel',
        onGetValues: function (values) {
            values.restart = 1;
            values.force = 1;
            if (!values.key) {
                delete values.key;
            }
            return values;
        },
        items: [
            {
                fieldLabel: gettext('Private Key (Optional)'),
                labelAlign: 'top',
                emptyText: gettext('No change'),
                name: 'key',
                xtype: 'textarea',
            },
            {
                xtype: 'filebutton',
                text: gettext('From File'),
                listeners: {
                    change: function (btn, e, value) {
                        let form = this.up('form');
                        for (const file of e.event.target.files) {
                            PVE.Utils.loadFile(file, (res) =>
                                form.down('field[name=key]').setValue(res),
                            );
                        }
                        btn.reset();
                    },
                },
            },
            {
                fieldLabel: gettext('Certificate Chain'),
                labelAlign: 'top',
                allowBlank: false,
                name: 'certificates',
                xtype: 'textarea',
            },
            {
                xtype: 'filebutton',
                text: gettext('From File'),
                listeners: {
                    change: function (btn, e, value) {
                        let form = this.up('form');
                        for (const file of e.event.target.files) {
                            PVE.Utils.loadFile(file, (res) =>
                                form.down('field[name=certificates]').setValue(res),
                            );
                        }
                        btn.reset();
                    },
                },
            },
        ],
    },

    initComponent: function () {
        let me = this;
        if (!me.nodename) {
            throw 'no nodename given';
        }
        me.url = `/nodes/${me.nodename}/certificates/custom`;

        me.callParent();
    },
});

Ext.define('pve-certificate', {
    extend: 'Ext.data.Model',
    fields: [
        'filename',
        'fingerprint',
        'issuer',
        'notafter',
        'notbefore',
        'subject',
        'san',
        'public-key-bits',
        'public-key-type',
    ],
    idProperty: 'filename',
});

Ext.define('PVE.node.Certificates', {
    extend: 'Ext.grid.Panel',
    xtype: 'pveCertView',

    tbar: [
        {
            xtype: 'button',
            text: gettext('Upload Custom Certificate'),
            handler: function () {
                let view = this.up('grid');
                Ext.create('PVE.node.CertUpload', {
                    nodename: view.nodename,
                    listeners: {
                        destroy: () => view.reload(),
                    },
                    autoShow: true,
                });
            },
        },
        {
            xtype: 'proxmoxStdRemoveButton',
            itemId: 'deletebtn',
            text: gettext('Delete Custom Certificate'),
            dangerous: true,
            selModel: false,
            getUrl: function (rec) {
                let view = this.up('grid');
                return `/nodes/${view.nodename}/certificates/custom?restart=1`;
            },
            confirmMsg: gettext('Delete custom certificate and switch to generated one?'),
            callback: function (options, success, response) {
                if (success) {
                    let txt = gettext(
                        'API server will be restarted to use new certificates, please reload web-interface!',
                    );
                    Ext.getBody().mask(txt, ['pve-static-mask']);
                    // reload after 10 seconds automatically
                    Ext.defer(() => window.location.reload(true), 10000);
                }
            },
        },
        '-',
        {
            xtype: 'proxmoxButton',
            itemId: 'viewbtn',
            disabled: true,
            text: gettext('View Certificate'),
            handler: function () {
                this.up('grid').viewCertificate();
            },
        },
    ],

    columns: [
        {
            header: gettext('File'),
            width: 150,
            dataIndex: 'filename',
        },
        {
            header: gettext('Issuer'),
            flex: 1,
            dataIndex: 'issuer',
        },
        {
            header: gettext('Subject'),
            flex: 1,
            dataIndex: 'subject',
        },
        {
            header: gettext('Public Key Algorithm'),
            flex: 1,
            dataIndex: 'public-key-type',
            hidden: true,
        },
        {
            header: gettext('Public Key Size'),
            flex: 1,
            dataIndex: 'public-key-bits',
            hidden: true,
        },
        {
            header: gettext('Valid Since'),
            width: 150,
            dataIndex: 'notbefore',
            renderer: Proxmox.Utils.render_timestamp,
        },
        {
            header: gettext('Expires'),
            width: 150,
            dataIndex: 'notafter',
            renderer: Proxmox.Utils.render_timestamp,
        },
        {
            header: gettext('Subject Alternative Names'),
            flex: 1,
            dataIndex: 'san',
            renderer: PVE.Utils.render_san,
        },
        {
            header: gettext('Fingerprint'),
            dataIndex: 'fingerprint',
            hidden: true,
        },
        {
            header: gettext('PEM'),
            dataIndex: 'pem',
            hidden: true,
        },
    ],

    reload: function () {
        this.rstore.load();
    },

    viewCertificate: function () {
        let me = this;
        let selection = me.getSelection();
        if (!selection || selection.length < 1) {
            return;
        }
        var win = Ext.create('PVE.node.CertificateViewer', {
            cert: selection[0].data.filename,
            nodename: me.nodename,
        });
        win.show();
    },

    listeners: {
        itemdblclick: 'viewCertificate',
    },

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no nodename given';
        }

        me.rstore = Ext.create('Proxmox.data.UpdateStore', {
            storeid: 'certs-' + me.nodename,
            model: 'pve-certificate',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/nodes/' + me.nodename + '/certificates/info',
            },
        });

        me.store = {
            type: 'diff',
            rstore: me.rstore,
        };

        me.callParent();

        me.mon(me.rstore, 'load', (store) =>
            me.down('#deletebtn').setDisabled(!store.getById('pveproxy-ssl.pem')),
        );
        me.rstore.startUpdate();
        me.on('destroy', me.rstore.stopUpdate, me.rstore);
    },
});
