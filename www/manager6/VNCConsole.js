Ext.define('PVE.noVncConsole', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveNoVncConsole',

    nodename: undefined,
    vmid: undefined,
    cmd: undefined,

    consoleType: undefined, // lxc, kvm, shell, cmd
    xtermjs: false,

    layout: 'fit',
    border: false,

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        if (!me.consoleType) {
            throw 'no console type specified';
        }

        if (!me.vmid && me.consoleType !== 'shell' && me.consoleType !== 'cmd') {
            throw 'no VM ID specified';
        }

        // always use same iframe, to avoid running several noVnc clients
        // at same time (to avoid performance problems)
        var box = Ext.create('Ext.ux.IFrame', { itemid: 'vncconsole', flex: 1 });

        let warning = Ext.create('Ext.Component', {
            userCls: 'pmx-hint',
            padding: 5,
            hidden: true,
            style: {
                'text-align': 'center',
            },
            html: gettext(
                'Application container detected - console might not be fully functional.',
            ),
        });

        var type = me.xtermjs ? 'xtermjs' : 'novnc';
        Ext.apply(me, {
            layout: {
                type: 'vbox',
                align: 'stretch',
            },
            items: [warning, box],
            listeners: {
                activate: function () {
                    let sp = Ext.state.Manager.getProvider();
                    if (Ext.isFunction(me.beforeLoad)) {
                        me.beforeLoad();
                    }
                    let queryDict = {
                        console: me.consoleType, // kvm, lxc, upgrade or shell
                        vmid: me.vmid,
                        node: me.nodename,
                        cmd: me.cmd,
                        'cmd-opts': me.cmdOpts,
                        resize: sp.get('novnc-scaling', 'scale'),
                    };
                    queryDict[type] = 1;
                    PVE.Utils.cleanEmptyObjectKeys(queryDict);
                    var url = '/?' + Ext.Object.toQueryString(queryDict);
                    box.load(url);
                },
            },
        });

        me.callParent();

        // check for app container
        if (me.consoleType === 'lxc') {
            Proxmox.Utils.API2Request({
                url: `/nodes/${me.nodename}/lxc/${me.vmid}/config`,
                success: function (response) {
                    let consoleMode = response?.result?.data?.cmode;
                    let entryPoint = response?.result?.data?.entrypoint;
                    let customEntryPoint = entryPoint !== undefined && entryPoint !== '/sbin/init';

                    if (customEntryPoint && consoleMode === 'console') {
                        warning.setVisible(true);
                        setTimeout(() => {
                            warning.setVisible(false);
                        }, 8_000);
                    }
                },
            });
        }

        me.on('afterrender', function () {
            box.focus();
        });
    },

    reload: function () {
        // reload IFrame content to forcibly reconnect VNC/xterm.js to VM
        var box = this.down('[itemid=vncconsole]');
        box.getWin().location.reload();
    },
});
