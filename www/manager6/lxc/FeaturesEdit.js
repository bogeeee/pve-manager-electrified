Ext.define('PVE.lxc.FeaturesInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveLxcFeaturesInputPanel',
    onlineHelp: 'pct_options',

    // used to save the mounts fstypes until sending
    mounts: [],

    fstypes: ['nfs', 'cifs'],

    viewModel: {
        parent: null,
        data: {
            unprivileged: false,
        },
        formulas: {
            privilegedOnly: function (get) {
                return get('unprivileged') ? gettext('privileged only') : '';
            },
            unprivilegedOnly: function (get) {
                return !get('unprivileged') ? gettext('unprivileged only') : '';
            },
        },
    },

    items: [
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('keyctl'),
            name: 'keyctl',
            bind: {
                disabled: '{!unprivileged}',
                boxLabel: '{unprivilegedOnly}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Nesting'),
            name: 'nesting',
        },
        {
            xtype: 'proxmoxcheckbox',
            name: 'nfs',
            fieldLabel: 'NFS',
            bind: {
                disabled: '{unprivileged}',
                boxLabel: '{privilegedOnly}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            name: 'cifs',
            fieldLabel: 'SMB/CIFS',
            bind: {
                disabled: '{unprivileged}',
                boxLabel: '{privilegedOnly}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            name: 'fuse',
            fieldLabel: 'FUSE',
        },
        {
            xtype: 'proxmoxcheckbox',
            name: 'mknod',
            fieldLabel: gettext('Create Device Nodes'),
            boxLabel: gettext('Experimental'),
        },
    ],

    onGetValues: function (values) {
        var me = this;
        var mounts = me.mounts;
        me.fstypes.forEach(function (fs) {
            if (values[fs]) {
                mounts.push(fs);
            }
            delete values[fs];
        });

        if (mounts.length) {
            values.mount = mounts.join(';');
        }

        var featuresstring = PVE.Parser.printPropertyString(values, undefined);
        if (featuresstring === '') {
            return { delete: 'features' };
        }
        return { features: featuresstring };
    },

    setValues: function (values) {
        var me = this;

        me.viewModel.set('unprivileged', values.unprivileged);

        if (values.features) {
            let res = PVE.Parser.parsePropertyString(values.features);
            me.mounts = [];
            if (res.mount) {
                res.mount.split(/[; ]/).forEach(function (item) {
                    if (me.fstypes.indexOf(item) === -1) {
                        me.mounts.push(item);
                    } else {
                        res[item] = 1;
                    }
                });
            }
            this.callParent([res]);
        }
    },

    initComponent: function () {
        let me = this;
        me.mounts = []; // reset state
        me.callParent();
    },
});

Ext.define('PVE.lxc.FeaturesEdit', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveLxcFeaturesEdit',

    subject: gettext('Features'),
    autoLoad: true,
    width: 350,

    items: [
        {
            xtype: 'pveLxcFeaturesInputPanel',
        },
    ],
});
